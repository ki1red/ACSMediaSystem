const express = require('express');
const path = require('path');
const moment = require('moment-timezone');
const NodeMediaServer = require('node-media-server');
const axios = require('axios');
const dbms = require(path.join(__dirname, '..', 'libs', 'dbms'));
const cron = require('node-cron');
const fmpt = require(path.join(__dirname, '..', 'libs', 'cffmpeg')).fmpt;

const config = require(path.join(__dirname, '..', 'libs', 'configs')).streaming_service_config;

let stream_playlist = [];
let stream_process = null;

// Создаем экземпляр Express приложения
const server = express();
server.use(express.json());

// Создаем экземпляр Node-Media-Server
const nms = new NodeMediaServer(config);

// Запускаем Node-Media-Server
nms.run();

// Обработчик события ready для Node-Media-Server
nms.on('ready', () => {
    console.log('Node Media Server is ready');
});

// Обработчик события prePublish для Node-Media-Server
nms.on('prePublish', async (id, StreamPath, args) => {
    console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

// Роут для управления сервером через локальное API
server.post('/prepare-objects', async (req, res) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const full_datetime_current = moment().tz(timezone).format('YYYY-MM-DD HH:mm:ss');

    const temp_playlist = await dbms.getPlaylist(full_datetime_current);
    if (!temp_playlist || temp_playlist.length == 0) {
        return;
    }
    updatePlaylist(temp_playlist);
    res.status(200).send('Stream restart requested');
});
server.post('/stop', (req, res) => {
    if (stream_process) {
        fmpt.kill(stream_process);
    }
});

// Слушаем указанный порт для локального API
server.listen(config.api_port, () => {
    console.log(`Local API listening at ${config.api_port}`);

    axios.post('http://localhost:4035/prepare-objects', null)
    .then(response => {
        console.log('First request to start stream is complete');
    })
    .catch(error => {
        console.log('tututut');
    });
});

function startStream(index_array) {
    const time_cron = convertToCron(stream_playlist[index_array].full_datetime_start);
    console.log(time_cron);
    const cron_process = cron.schedule(time_cron, () => {
        if (stream_playlist.length == 0) {
            //console.log('Playlist is empty');
            return;
        }
        console.log(`PROCESS: ${stream_process} already`);
        if (stream_process) {
            //console.log(`PROCESS: ${stream_process} killed`);
            fmpt.kill(stream_process);
        }
        const file_name = stream_playlist[index_array].file_name;
        const file_format = stream_playlist[index_array].file_format;
        const full_datetime_start = stream_playlist[index_array].full_datetime_start;
        const file_path = path.join(config.upload_dir, `${file_name}.${file_format}`);
        stream_process = fmpt.streamVideo(file_path);
    });
    //console.log(`CRON PROCESS ${cron_process}`);
    //console.log(`file_path ${stream_playlist[0].file_name}`);
    stream_playlist[index_array].cron_process = cron_process;
}

function updatePlaylist(input_arr) {
    //console.log(`UPDATE START`)
    //console.log(`TEMP`)
    //console.log(input_arr);
    //console.log(`STREAM`);
    //console.log(stream_playlist);
    // Проверяем длину массивов
    while (stream_playlist.length > input_arr.length) {
        //console.log(`DELETE ELEMENT`);
        //console.log(stream_playlist.at(-1));
        const cron_process = stream_playlist.at(-1).cron_process;
        if (cron_process) {
            //console.log(`STOP PROCESS`)
            cron_process.stop();
        }
        stream_playlist.pop();
    }
    // Проверяем содержимое массивов
    for (let i = 0; i < stream_playlist.length; i++) {
        const element = input_arr[i];
        const old_element = stream_playlist[i];
        //console.log(`ELEMENT NEW`);
        //console.log(element);
        //console.log(`ELEMENT OLD`);
        //console.log(old_element);
        if (element.file_name !== old_element.file_name ||
            element.file_format !== old_element.file_format ||
            element.full_datetime_start !== old_element.full_datetime_start) {
            //console.log(`DIFFERENT ELEMENTS`);
            //console.log(element, old_element)
            if (old_element.cron_process) {
                //console.log(`STOP PROCESS`)
                old_element.cron_process.stop();
            }
            stream_playlist[i] = element;
            startStream(i);
        }
    }

    for (let i = stream_playlist.length; i < input_arr.length; i++) {
        const element = input_arr[i];
        console.log(`ADDED ELEMENT`);
        console.log(element);
        stream_playlist.push(element);
        startStream(i);
    }
    console.log(`UPDATE STOP`);
    console.log(stream_playlist); console.log(input_arr);
}

function convertToCron(dateTimeString) {
    // Разбиваем строку даты-времени на компоненты
    const dateTimeComponents = dateTimeString.split(' ');
    if (dateTimeComponents.length !== 2) {
        throw new Error('Invalid date-time format');
    }
    
    // Разбиваем компоненты даты на день, месяц и год
    const dateComponents = dateTimeComponents[0].split('-');
    if (dateComponents.length !== 3) {
        throw new Error('Invalid date format');
    }
    
    // Разбиваем компонент времени на часы, минуты и секунды
    const timeComponents = dateTimeComponents[1].split(':');
    if (timeComponents.length !== 3) {
        throw new Error('Invalid time format');
    }
    
    // Формируем выражение крона
    const second = timeComponents[2];
    const minute = timeComponents[1];
    const hour = timeComponents[0];
    const dayOfMonth = dateComponents[2];
    const month = dateComponents[1];
    const dayOfWeek = '*'; // Мы не указываем конкретный день недели
    const year = dateComponents[0];

    // Возвращаем сформированное выражение крона
    return `${second} ${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
}