const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const body_parser = require('body-parser');
const moment = require('moment-timezone');
const axios = require('axios');
const { exit } = require('process');
let cors = require('cors');

const config = require(path.join(__dirname, '..', 'libs', 'configs')).api_interface_config;
const fmp = require(path.join(__dirname, '..', 'libs', 'cffmpeg')).fmp;
const dbms = require(path.join(__dirname, '..', 'libs', 'dbms'));
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const server = express();

// Middleware для обработки JSON данных
server.use(body_parser.json());
server.use(cors());

// Middleware для обработки файлов в формах данных
const upload = multer({ dest: config.upload_dir });

server.post('/uploadmedia', upload.fields([{ name: 'mediaFile' }, { name: 'jsonFile' }]), async (req, res) => {
    try {
        if (!req.body || !req.body.jsonFile) {
            throw new Error('Invalid file information');
        }
        // Получение JSON данных из тела запроса
        const jsonData = JSON.parse(req.body.jsonFile);

        // Проверка наличия необходимых полей в JSON файле
        const expectedFields = ['file_type', 'file_name', 'file_format'];
        const missingFields = expectedFields.filter(field => !(field in jsonData));
        if (missingFields.length > 0) {
            throw new Error('Invalid file information');
        }

        contentFileIsCorrect(jsonData);

        // Проверка наличия файла с таким именем и расширением
        if (isFindJson(config.upload_dir, jsonData.file_name, jsonData.file_format) ||
            isFindMedia(config.upload_dir, jsonData.file_name, jsonData.file_format)) {
            throw new Error('File already exists');
        }

        // Подготовка и создание медиафайла на сервере (установка разрешения изображения)
        const mediaFile = req.files['mediaFile'][0];
        if (!mediaFile) {
            throw new Error('Media file is required');
        }
        const mediaFileName = `${jsonData.file_name}.${jsonData.file_format}`;

        fs.renameSync(mediaFile.path, path.join(config.upload_dir, mediaFileName));

        const jsonFileName = `${jsonData.file_name}.${jsonData.file_format}.json`;
        const jsonFilePath = path.join(config.upload_dir, jsonFileName);

        if (jsonData.file_type == 'video') {
            jsonData.seconds = fmp.getSeconds(path.join(config.upload_dir, `${jsonData.file_name}.${jsonData.file_format}`));
        }
        jsonData.value_type = 'source';
        jsonData.refs = [];
        fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 4));

        // Отправка ответа клиенту
        console.log(`File uploaded: ${mediaFileName}`);
        res.status(200).send('Data uploaded successfully');
    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500);
            exit();
        }

        console.error('Error during upload:', err.message);
        cleanFilesWithoutExtension(config.upload_dir);
        res.status(400).send(err.message);
    }
});

server.get('/listmedia', async (req, res) => {
    try {
        const uploadDir = config.upload_dir;

        // Чтение содержимого всех JSON-файлов в папке uploadDir
        fs.readdir(uploadDir, (err, files) => {
            if (err) {
                console.error('Error reading upload directory:', err.message);
                throw new Error('Error reading files');
            }

            const jsonData = [];

            // Чтение содержимого каждого JSON-файла
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const filePath = path.join(uploadDir, file);
                    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    jsonData.push(fileContent);
                }
            });

            // Отправка массива данных пользователю
            res.status(200).json(jsonData);
        });
    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500);
        }

        console.error('Error during list request:', err.message);
        res.status(500).send(err.message);
    }
});

server.delete('/deletemedia', async (req, res) => { // здесь parse не нужен и данные видно автоматически во всем теле, если отправить их под видом data
    try {
        if (!req.body) {
            throw new Error('Invalid file information');
        }
        const jsonData = req.body;

        // Проверка наличия всех необходимых полей в JSON файле
        const expectedFields = ['file_type', 'file_name', 'file_format'];
        const missingFields = expectedFields.filter(field => !(field in jsonData));
        if (missingFields.length > 0) {
            throw new Error('Invalid file information');
        }

        contentFileIsCorrect(jsonData);

        // Поиск JSON файла с данными о медиафайле
        const jsonFileName = `${jsonData.file_name}.${jsonData.file_format}.json`;
        const jsonFilePath = path.join(config.upload_dir, jsonFileName);
        if (!fs.existsSync(jsonFilePath)) {
            throw new Error('Json file about media file not found');
        }

        // Проверка данных в JSON файле
        const jsonData_aboutMedia = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
        if (jsonData_aboutMedia.file_format !== jsonData.file_format || jsonData_aboutMedia.file_type !== jsonData.file_type || jsonData_aboutMedia.file_name !== jsonData.file_name) {
            throw new Error('Mismatch in file data');
        }

        // Проверка, что файл не используется
        if (jsonData_aboutMedia.using === 1) { // TODO добавить проверку по бд или что-то ещё
            throw new Error('Media file is currently in use');
        }

        // Путь к медиафайлу
        const mediaFilePath = path.join(config.upload_dir, `${jsonData.file_name}.${jsonData.file_format}`);
        if (!fs.existsSync(mediaFilePath)) {
            throw new Error('Media file not found');
        }

        // Удаление медиафайла и JSON файла
        fs.unlinkSync(mediaFilePath);
        fs.unlinkSync(jsonFilePath);

        console.log(`File ${jsonData.file_name}.${jsonData.file_format} deleted`);
        res.status(200).send('File deleted successfully');
    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500);
        }

        console.error('Error during delete request:', err.message);
        if (err.code === 'ENOENT') {
            res.status(404).send('File not found');
        } else {
            res.status(400).send(err.message);
        }
    }
});

server.put('/tovideo', async (req, res) => { // TODO ошибки из функций iTV и pTV не всегда обрабатываются в этом try catch
    try {
        // Проверяем, что в запросе есть тело
        if (!req.body || !Array.isArray(req.body) || req.body.length !== 3) {
            console.error(req.body);
            throw new Error('Invalid request body');
        }

        const source = req.body[0], output = req.body[1], additional = req.body[2];

        // Проверяем наличие всех обязательных полей в каждом объекте массива
        const requiredFields = ['file_type', 'file_name', 'file_format'];
        const requiredFields2 = ['seconds'];
        const missingFields = [];
        requiredFields.forEach(field => {
            if (!(field in source)) {
                missingFields.push(field);
            }
            if (!(field in output)) {
                missingFields.push(field);
            }
        });
        requiredFields2.forEach(field => {
            if (!(field in additional)) {
                missingFields.push(field);
            }
        });
        if (missingFields.length > 0) {
            throw new Error('Missing required fields in file data');
        }

        contentFileIsCorrect(source);
        contentFileIsCorrect(output);
        if (output.file_type !== 'video') {
            throw new Error('New file do not have video format');
        }
        if (source.file_type == 'video') {
            throw new Error('Old file is video');
        }

        // Проверка наличия файла с таким именем и расширением
        if (!isFindJson(config.upload_dir, source.file_name, source.file_format) ||
        !isFindMedia(config.upload_dir, source.file_name, source.file_format)) {
            throw new Error('Source file not already exists');
        }
        // Проверка наличия файла с таким именем и расширением
        if (isFindJson(config.upload_dir, output.file_name, output.file_format) ||
        isFindMedia(config.upload_dir, output.file_name, output.file_format)) {
            throw new Error('Output file already exists');
        }

        // Обрабатываем исходный файл
        switch (source.file_type) {
            case 'image':
                // Обработка изображений
                await fmp.imageToVideo(`${path.join(config.upload_dir, `${source.file_name}.${source.file_format}`)}`,
                    `${path.join(config.upload_dir, `${output.file_name}.${output.file_format}`)}`,
                    additional.seconds, 1920, 1080);
                output.seconds = additional.seconds; // TODO считать через getSeconds
                break;
            case 'presentation':
                // Обработка презентаций
                await fmp.presentationToVideo(`${path.join(config.upload_dir, `${source.file_name}.${source.file_format}`)}`,
                    `${path.join(config.upload_dir, `${output.file_name}.${output.file_format}`)}`,
                    additional.seconds, 1920, 1080);
                output.seconds = fmp.getSeconds(path.join(config.upload_dir, `${output.file_name}.${output.file_format}`));
                break;
            default:
                console.error(`Unsupported file type: ${file.file_type}`);
                throw new Error('Source file is incorrect');
        }
        // Создаем для нового медиафайл - файл описания
        const jsonFilePath = path.join(config.upload_dir,`${output.file_name}.${output.file_format}.json`);
        output.using = 0;
        fs.writeFileSync(jsonFilePath, JSON.stringify(output, null, 4));

        res.status(200).send('File converting');

    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500); // TODO пересмотреть все коды ошибок в API.md
        }

        console.error(err.message);
        res.status(400).send(err.message);
    }
});

server.post('/placeelement', async (req, res) => {
    try {
        // Проверяем, что в запросе есть тело
        if (!req.body) {
            console.error(req.body);
            throw new Error('Invalid request body');
        }
        //console.log(req.body);

        // Проверка наличия нужных полей
        const jsonData = req.body;
        const requiredFields = ['file_type', 'file_name', 'file_format', 'full_start_time', 'time_zone', 'priority'];
        const missingFields = requiredFields.filter(field => !(field in jsonData));
        if (missingFields.length > 0) {
            throw new Error('Invalid file information');
        }

        contentFileIsCorrect(jsonData);
        
        // Проверяем точное наличие этого файла на сервере
        if (!isFindJson(config.upload_dir, jsonData.file_name, jsonData.file_format) ||
                !isFindMedia(config.upload_dir, jsonData.file_name, jsonData.file_format)) {
            throw new Error('Source file not already exists');
        }

        if (jsonData.file_type !== 'video') {
            throw new Error('Source file is not a video');
        }

        // Проверка даты и часового пояса на корректность
        if (!moment(jsonData.full_start_time, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
            throw new Error('Date is not correct');
        }
        if (!moment.tz.names().includes(jsonData.time_zone)) {
            throw new Error('TimeZone is not correct');
        }

        const path_hdd_json_data = path.join(config.upload_dir, `${jsonData.file_name}.${jsonData.file_format}.json`);
        const hdd_json_data = JSON.parse(fs.readFileSync(path_hdd_json_data, 'utf8'));
        const seconds = hdd_json_data.seconds;

        // Преобразовываем время в местное
        const full_datetime_start = moment.tz(jsonData.full_start_time, jsonData.time_zone).tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        const full_datetime_end = moment.tz(jsonData.full_start_time, jsonData.time_zone).add(seconds, 'seconds').tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        
        const full_datetime_current = moment().tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        if (full_datetime_start <= full_datetime_current) {
            throw new Error('Time has already passed');
        }

        // Получаем список элементов, пересекающихся с нынешним
        const overlays = await dbms.searchOverlays(full_datetime_start, full_datetime_end);
        if (overlays.length > 0) {
            const important_overlays = overlays.some(overlay => overlay.priority >= jsonData.priority);
            //console.log(overlays);
            if (important_overlays) {
                throw new Error('Multiple layers');
            }
        }

        await dbms.addData(jsonData.file_name, jsonData.file_format,
            full_datetime_start, full_datetime_end, jsonData.priority);
        
        // Метим файл, что он используется
        hdd_json_data.using = 1;
        fs.writeFileSync(path_hdd_json_data, JSON.stringify(hdd_json_data, null, 4));
        
        // Отправляем успешный ответ, если все шаги выполнены без ошибок
        res.status(200).send('Element added');

        axios.post('http://localhost:4035/prepare-objects', null)
            .then(response => {
                console.log(response.message);
            })
            .catch(error => {
                console.log('Not connected');
            });
    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500);
        }

        // Если возникла ошибка, отправляем соответствующий статус и сообщение об ошибке
        console.error(err.message);
        res.status(400).send(err.message);
    }
});

server.get('/listelements', async (req, res) => {
    const timezoneInfo = {
        timezone: timezone
    };

    const jsonData = await dbms.getList();
    jsonData.push(timezoneInfo);
    
    res.status(200).json(jsonData);
});

server.put('/moveelement', async (req, res) => {
    try {
        // Проверяем, что в запросе есть тело
        if (!req.body) {
            console.error(req.body);
            throw new Error('Invalid request body');
        }
        console.log(req.body);

        // Проверка наличия нужных полей
        const jsonData = req.body;
        const requiredFields = ['id_element', 'full_datetime_start_new', 'time_zone'];
        const missingFields = requiredFields.filter(field => !(field in jsonData));
        if (missingFields.length > 0) {
            throw new Error('Invalid file information');
        }

        // Проверка даты и часового пояса на корректность
        if (!moment(jsonData.full_datetime_start_new, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
            throw new Error('Date is not correct');
        }
        if (!moment.tz.names().includes(jsonData.time_zone)) {
            throw new Error('TimeZone is not correct');
        }

        // Проверка наличия элемента в очереди
        const element = await dbms.getData(jsonData.id_element);
        if (!element) {
            res.status(500).send('Element not exists');
            return;
        }

        // Получение описательного файла
        const path_hdd_json_data = path.join(config.upload_dir, `${element.file_name}.${element.file_format}.json`);
        const hdd_json_data = JSON.parse(fs.readFileSync(path_hdd_json_data, 'utf8'));

        // Приведение времени к локальному времени
        const full_datetime_start_new_localzone = moment.tz(jsonData.full_datetime_start_new, jsonData.time_zone).tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        const full_datetime_end_new_localzone = moment.tz(jsonData.full_datetime_start_new, jsonData.time_zone).add(hdd_json_data.seconds, 'seconds').tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        const full_datetime_current = moment().tz(timezone).format('YYYY-MM-DD HH:mm:ss');

        // Проверяем, что не перемещаем видеофрагмент с или на нынешнее время (или в прошлое)
        if (full_datetime_current >= full_datetime_start_new_localzone) {
            throw new Error('The new date and time have already passed');
        } else if (full_datetime_current >= element.full_datetime_start) {
            throw new Error('The old date and time have already passed');
        }

        // Проверяем отсутствие накладок
        const overlays = await dbms.searchOverlays(full_datetime_start_new_localzone, full_datetime_end_new_localzone);
        if (overlays.length > 1) {
            throw new Error('Multiple layers');
        } else if (overlays.length == 1 && overlays[0].id !== element.id) {
            throw new Error('Multiple layers');
        }

        await dbms.updateData(element.id, element.file_name, element.file_format, full_datetime_start_new_localzone, full_datetime_end_new_localzone, element.priority);
        
        res.status(200).send('Element moved');
        axios.post('http://localhost:4035/prepare-objects', null)
            .then(response => {
                console.log(response.message);
            })
            .catch(error => {
                console.log('Not connected');
            });
    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500);
        }

        console.error(err.message);
        res.status(400).send(err.message);
    }
});

server.delete('/deleteelement', async (req, res) => { // TODO разве важно наличие источника при удалении ссылания?
    try {
        if (!req.body) {
            throw new Error('Invalid request body');
        }
        const jsonData = req.body;

        // Проверка наличия всех необходимых полей в JSON файле
        const expectedFields = ['id_element'];
        const missingFields = expectedFields.filter(field => !(field in jsonData));
        if (missingFields.length > 0) {
            throw new Error('Invalid file information');
        }

        const element = await dbms.getData(jsonData.id_element);
        if (!element) {
            res.status(500).send('Element not exists');
            return;
        }

        const full_datetime_current = moment().tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        // Сравниваем текущее время с временным диапазоном элемента
        if (full_datetime_current >= element.full_datetime_start &&
            full_datetime_current <= element.full_datetime_end) {
            res.status(400).send('Currently in use');
            return;
        }

        if (await dbms.deleteDataById(jsonData.id_element)) {
            const file_name = element.file_name;
            const file_format = element.file_format;
            const elements = await dbms.getLinksToFile(file_name, file_format, full_datetime_current);
            // Изменение используемости у файла, в случае отсутствия ссылок на него
            if (elements.length == 0) {
                const path_hdd_json_data = path.join(config.upload_dir, `${file_name}.${file_format}.json`);
                const hdd_json_data = JSON.parse(fs.readFileSync(path_hdd_json_data, 'utf8'));

                hdd_json_data.using = 0;

                fs.writeFileSync(path_hdd_json_data, JSON.stringify(hdd_json_data, null, 4));
            } 
            res.status(200).send('Element deleted');

            axios.post('http://localhost:4035/prepare-objects', null)
                .then(response => {
                    console.log(response);
                })
                .catch(error => {
                    console.log('Not connected');
                });
        }
    } catch (err) {
        if (!err.message) {
            console.error(err);
            res.status(500);
        }

        console.error(err);
        res.status(400).send(err.message);
    }
});

server.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
});

function contentFileIsCorrect(file_data) {
    // Проверка наличия допустимого типа файла
    let format_list = ['image', 'video', 'presentation'];
    if (!format_list.includes(file_data.file_type)) {
        throw new Error('Invalid file type');
    } else {
        // Проверка корректности формата файла в зависимости от типа
        if (file_data.file_type === 'image') {
            format_list = ['png', 'jpg', 'jpeg'];
        } else if (file_data.file_type === 'video') {
            format_list = ['mp4', 'mov'];
        } else if (file_data.file_type === 'presentation') {
            format_list = ['pdf'];
        }
        if (!format_list.includes(file_data.file_format)) {
            throw new Error('Invalid file format');
        }
    }
}

function cleanFilesWithoutExtension(directoryPath) {
    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(directoryPath, file);

            // Проверяем, является ли файл директорией
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error checking file stats:', err);
                    return;
                }

                if (stats.isFile()) {
                    // Проверяем, имеет ли файл расширение
                    const fileExtension = path.extname(file);
                    if (fileExtension === '') {
                        // Если файл не имеет расширения, удаляем его
                        fs.unlink(filePath, err => {
                            if (err) {
                                console.error('Error deleting file:', err);
                                return;
                            }
                            console.log(`File ${file} deleted successfully.`);
                        });
                    }
                }
            });
        });
    });
}

function isFindJson(file_path, file_name, file_format) {
    const fullPath = path.join(file_path, `${file_name}.${file_format}.json`);
    return fs.existsSync(fullPath);
}

function isFindMedia(file_path, file_name, file_format) {
    const fullPath = path.join(file_path, `${file_name}.${file_format}`);
    return fs.existsSync(fullPath);
}