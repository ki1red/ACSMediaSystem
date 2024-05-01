const path = require('path');
const { spawn } = require('child_process');
const config = require(path.join(__dirname, 'libs', 'configs')).start_config;

const path_create_database = path.join(__dirname, 'libs', 'initdb.js');
const path_api_server = path.join(__dirname, 'api-interface', 'server.js');
const path_service_server = path.join(__dirname, 'streaming-service', 'server.js');

// Создаем процесс для создания базы данных
const create_database = spawn(config.system_node_command, [path_create_database]);

// Слушаем событие 'exit' для создания базы данных
create_database.on('exit', (code, signal) => {
    if (code === 0) {
        console.log('Database created');
        // Запускаем остальные процессы после создания базы данных
        startServers();
    } else {
        console.error('Error:', signal);
    }
});

// Функция для запуска серверов API и streaming service
function startServers() {
    // Запускаем сервер API
    const api_server = spawn(config.system_node_command, [path_api_server]);
    api_server.on('error', (err) => {
        console.error('Error creating api:', err);
    });
    api_server.stdout.on('data', (data) => {
        console.log(`API SERVER data: ${data}`);
    });
    api_server.on('close', (code) => {
        console.log(`API SERVER close all stdio with code: ${code}`);
    });
    api_server.on('exit', (code) => {
        console.log(`API SERVER exited with code ${code}`);
    }); 
    console.log('API SERVER started');

    // Запускаем сервер streaming service
    const service_server = spawn(config.system_node_command, [path_service_server]);
    service_server.on('error', (err) => {
        console.error('Error creating stream:', err);
    });
    service_server.stdout.on('data', (data) => {
        console.log(`STREAM SERVER data: ${data}`);
    });
    service_server.on('close', (code) => {
        console.log(`STREAM SERVER close all stdio with code: ${code}`);
    });
    service_server.on('exit', (code) => {
        console.log(`STREAM SERVER exited with code ${code}`);
    }); 
    console.log('STREAM SERVER started');
}
