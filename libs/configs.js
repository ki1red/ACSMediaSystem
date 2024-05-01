const path = require('path');

const start_config = {
    system_node_command: 'node'
};

const api_interface_config = {
    port: 4004,
    upload_dir: path.join(__dirname, '..', 'uploads')
};

const cffmpeg_config = {
    path: '/usr/bin/ffmpeg',
    rtmp_url: 'rtmp://localhost:1935/live/stream'
};

const streaming_service_config = {
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
    },
    http: {
        port: 8000,
        mediaroot: path.join(__dirname, '..', 'uploads'),
        allow_origin: '*'
    },
    trans: {
        ffmpeg: cffmpeg_config.path,
        tasks: [
            {
                app: 'live',
                ac: 'aac',
                mp4: true,
                mp4Flags: '[movflags=faststart]'
            }
        ]
    },
    api_port: 4035,
    upload_dir: path.join(__dirname, '..', 'uploads')
};

module.exports = { start_config, api_interface_config, streaming_service_config, cffmpeg_config };