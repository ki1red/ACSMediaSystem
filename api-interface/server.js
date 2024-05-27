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

server.delete('/deleteallrefmedia', async (req, res) => {
    await autoDeleteRefMedia();
    res.status(200).send('All ref media are deleted');
});

server.delete('/deleteunloadedmedia', async (req, res) => {
    await deleteUnloadedMedia();
    res.status(200).send('All undloaded media are deleted');
});

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
        if (jsonData_aboutMedia.value_type !== 'source') { // TODO добавить проверку по бд или что-то ещё
            throw new Error('Media file is not source');
        }
        else if (jsonData_aboutMedia.refs.length > 0) {
            throw new Error('Media file is using');
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

        const path_source_media = path.join(config.upload_dir, `${source.file_name}.${source.file_format}`);
        const path_output_media = path.join(config.upload_dir, `${output.file_name}.${output.file_format}`);
        // Обрабатываем исходный файл
        switch (source.file_type) {
            case 'image':
                // Обработка изображений
                await fmp.imageToVideo(path_source_media, path_output_media, additional.seconds, 1920, 1080);
                output.seconds = additional.seconds; // TODO считать через getSeconds
                break;
            case 'presentation':
                // Обработка презентаций
                await fmp.presentationToVideo(path_source_media, path_output_media, additional.seconds, 1920, 1080);
                output.seconds = fmp.getSeconds(path_output_media);
                break;
            default:
                console.error(`Unsupported file type: ${file.file_type}`);
                throw new Error('Source file is incorrect');
        }
        // Создаем для нового медиафайл - файл описания
        const path_output_json = path.join(config.upload_dir,`${output.file_name}.${output.file_format}.json`);
        output.value_type = 'ref';
        output.refs = [];
        fs.writeFileSync(path_output_json, JSON.stringify(output, null, 4));

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
        const requiredFields = ['file_type', 'file_name', 'file_format', 'full_start_time', 'seconds', 'time_zone', 'priority'];
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

        // if (jsonData.file_type !== 'video') {
        //     throw new Error('Source file is not a video');
        // }

        // Проверка даты и часового пояса на корректность
        if (!moment(jsonData.full_start_time, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
            throw new Error('Date is not correct');
        }
        if (!moment.tz.names().includes(jsonData.time_zone)) {
            throw new Error('TimeZone is not correct');
        }

        // Преобразовываем время в местное
        const full_datetime_start = moment.tz(jsonData.full_start_time, jsonData.time_zone).tz(timezone).format('YYYY-MM-DD HH:mm:ss');
        const full_datetime_end = moment.tz(jsonData.full_start_time, jsonData.time_zone).add(jsonData.seconds, 'seconds').tz(timezone).format('YYYY-MM-DD HH:mm:ss');

        // Получаем список элементов, пересекающихся с нынешним
        const overlays = await dbms.searchOverlays(full_datetime_start, full_datetime_end);
        if (overlays.length > 0) {
            const important_overlays = overlays.some(overlay => overlay.priority >= jsonData.priority);
            //console.log(overlays);
            if (important_overlays) {
                throw new Error('Multiple layers');
            }
        }

        let path_source_json_data;
        let source_json_data;
        console.log(jsonData.file_type);
        if (jsonData.file_type == 'video') {
            path_source_json_data = path.join(config.upload_dir, `${jsonData.file_name}.${jsonData.file_format}.json`);
            source_json_data = JSON.parse(fs.readFileSync(path_source_json_data, 'utf8'));

            if (source_json_data.seconds !== jsonData.seconds) {
                throw new Error('Video seconds don\'t match');
            }
        } else {
            let media_file_name = `${jsonData.file_name}.${jsonData.file_format}`;
            console.log(`media_file_name ${media_file_name}`);
            const ref_json_data = await findJsonFile(jsonData.seconds, media_file_name, 'mp4'); // mp4 - по умолчанию
            console.log(ref_json_data);
            if (!ref_json_data) {
                const count = await getMaxNum(media_file_name, 'mp4') + 1;
                console.log(`count ${count}`);
                const data = [
                    {
                        file_type: jsonData.file_type,
                        file_name: jsonData.file_name,
                        file_format: jsonData.file_format
                    },
                    {
                        file_type: "video",
                        file_name: `${media_file_name}.${count}`,
                        file_format: "mp4"
                    },
                    {
                        seconds: jsonData.seconds
                    }
                ];
                console.log(data);
                await axios.put('http://localhost:4004/tovideo', data)
                
                media_file_name = `${media_file_name}.${count}`;
                console.log(media_file_name);
            } else {
                media_file_name = `${ref_json_data.file_name}`;
            }
            path_source_json_data = path.join(config.upload_dir, `${media_file_name}.mp4.json`);
            source_json_data = JSON.parse(fs.readFileSync(path_source_json_data, 'utf8')); 
        }

        const id = await dbms.addData(source_json_data.file_name, source_json_data.file_format,
            full_datetime_start, full_datetime_end, jsonData.priority);
        const response = await axios.get('http://localhost:4004/listelements')
        console.log(response);
        
        const full_datetime_current = moment().tz(timezone).format('YYYY-MM-DD HH:mm:ss');

        if (full_datetime_start >= full_datetime_current) {
            // Метим файл, что он используется
            source_json_data.refs.push(id);
        }
        
        fs.writeFileSync(path_source_json_data, JSON.stringify(source_json_data, null, 4));
        
        // Отправляем успешный ответ, если все шаги выполнены без ошибок
        res.status(200).send('Element added');

        await axios.post('http://localhost:4035/prepare-objects', null)
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

        // Проверяем отсутствие накладок
        const overlays = await dbms.searchOverlays(full_datetime_start_new_localzone, full_datetime_end_new_localzone);
        if (overlays.length > 1) {
            throw new Error('Multiple layers');
        } else if (overlays.length == 1 && overlays[0].id !== element.id) {
            throw new Error('Multiple layers');
        }

        hdd_json_data.refs = hdd_json_data.refs.filter(ref => ref !== element.id);
        const resolve = await dbms.updateData(element.id, element.file_name, element.file_format, full_datetime_start_new_localzone, full_datetime_end_new_localzone, element.priority);
        if (full_datetime_start_new_localzone >= full_datetime_current) {
            hdd_json_data.refs.push(element.id);
        }

        fs.writeFileSync(path_hdd_json_data, JSON.stringify(hdd_json_data, null, 4));

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

                hdd_json_data.refs = hdd_json_data.refs.filter(ref => ref !== element.id);

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

    const mseconds = config.autoclear * 1000;
    setInterval(autoDeleteRefMedia, mseconds);
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

async function findJsonFile(seconds, file_name, file_format) {
    // Считываем все файлы в директории
    const files = await fs.promises.readdir(config.upload_dir);

    // Создаем регулярное выражение для проверки шаблона имени файла
    const regex = new RegExp(`^${file_name}\\.\\d+\\.${file_format}\\.json$`);

    for (const file of files) {
        // TODO если в file есть подстрока file_name.file_format тогда идем дальше
        if (regex.test(file)) {
            // Формируем полный путь к файлу
            const filePath = path.join(config.upload_dir, file);

            // Проверяем, что это файл и что он имеет расширение .json
            const stat = await fs.promises.stat(filePath);
            if (stat.isFile() && path.extname(file) === '.json') {
                // Считываем содержимое файла
                const data = await fs.promises.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(data);

                // Проверяем соответствие условиям
                if (jsonData.file_type === 'video' && jsonData.seconds === seconds) {
                    return jsonData;
                }
            }
        }
    }

    // Если ничего не найдено, возвращаем null или можно кинуть ошибку
    return null;
}

async function getMaxNum(file_name, file_format) {
    const directory = config.upload_dir;

    // Считываем все файлы в директории
    const files = await fs.promises.readdir(directory);

    // Создаем регулярное выражение для проверки шаблона имени файла
    const regex = new RegExp(`^${file_name}\\.\\d+\\.${file_format}\\.json$`);
    let maxNum = 0;

    for (const file of files) {
        if (regex.test(file)) {
            // Извлекаем число N из имени файла
            const match = file.match(new RegExp(`${file_name}\\.(\\d+)\\.${file_format}\\.json$`));
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) {
                    maxNum = num;
                }
            }
        }
    }

    return maxNum;
}

async function autoDeleteRefMedia() {
    try {
        // Получаем список всех файлов в директории
        const files = fs.readdirSync(config.upload_dir);

        // Проходим по каждому файлу в директории
        files.forEach(file => {
            // Проверяем расширение файла
            if (path.extname(file) === '.json') {
                const path_json_data = path.join(config.upload_dir, file);

                // Читаем содержимое файла
                const json_data = JSON.parse(fs.readFileSync(path_json_data, 'utf8'));

                // Проверяем условия для удаления файла
                if (json_data.value_type === 'ref' && Array.isArray(json_data.refs) && json_data.refs.length === 0) {
                    const path_media_file = path.join(config.upload_dir, `${json_data.file_name}.${json_data.file_format}`);

                    // Удаляем JSON файл
                    fs.unlinkSync(path_json_data);
                    console.log(`Deleted the json file: ${path_json_data}`);

                    // Удаляем соответствующий медиафайл
                    if (fs.existsSync(path_media_file)) {
                        fs.unlinkSync(path_media_file);
                        console.log(`Deleted the media file: ${path_media_file}`);
                    } else {
                        console.log(`Media file is not found: ${path_media_file}`);
                    }
                }
            }
        });
    } catch (err) {
        console.error(err);
    }
}

async function deleteUnloadedMedia() {
    try {
        // Получаем список всех файлов в директории
        const files = fs.readdirSync(config.upload_dir);

        // Отфильтровываем файлы, оставляя только файлы с расширениями и исключая .json файлы
        const media_files = files.filter(file => {
            const ext = path.extname(file);
            return ext && ext !== '.json';
        });

        // Проходим по каждому медиафайлу и проверяем наличие соответствующего .json файла
        media_files.forEach(file => {
            const file_format = path.extname(file);
            const file_name = path.basename(file, file_format);

            if (!isFindJson(config.upload_dir, file_name, file_format.substring(1))) {
                // Удаляем медиафайл
                const path_media_file = path.join(config.upload_dir, file);
                fs.unlinkSync(path_media_file);
                console.log(`Deleted media: ${path_media_file}`);
            }
        });
    } catch (err) {
        console.error(err);
    }
}