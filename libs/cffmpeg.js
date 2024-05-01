const fluent_ffmpeg = require('fluent-ffmpeg');
const child_process = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require(path.join(__dirname, '..', 'libs', 'configs')).cffmpeg_config;

fluent_ffmpeg.setFfmpegPath(config.path);

const fmp = {
    // Функция для преобразования изображения в видео
    imageToVideo(imagePath, videoPath, seconds) {
        return new Promise((resolve, reject) => {
            fluent_ffmpeg()
                .input(imagePath)
                .inputOptions([`-loop 1`])
                .outputOptions([`-r 1`, `-t ${seconds}`, `-vf scale=1920:1080`])
                .output(videoPath)
                .on('end', () => {
                    console.log(`Image ${imagePath} converted to video ${videoPath}`);
                    resolve();
                })
                .on('error', (err) => {
                    console.error('Error converting image to video:', err);
                    reject();
                })
                .run();
        });
    },
    
    // Функция для преобразования презентации PDF в видео
    async presentationToVideo(pdfPath, videoPath, seconds, width, height) {
        return new Promise((resolve, reject) => {
            // Создание временной директории для изображений
            const tempDir = path.join(__dirname, '..', 'uploads', `temp_${new Date().getTime()}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }
            const imageOutput = path.join(tempDir, 'image');
            const command = `pdftoppm -jpeg -scale-to-x ${width} -scale-to-y ${height} "${pdfPath}" "${imageOutput}"`;
            child_process.exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error: ${error.message}`);
                    reject();
                }
                if (stderr) {
                    console.error(`stderr: ${stderr}`);
                    reject();
                }
                // Создание видео из изображений только после завершения pdftoppm
                fluent_ffmpeg()
                    .input(`${imageOutput}-%02d.jpg`)
                    .inputFPS(1/seconds)
                    .outputOptions('-c:v libx264')
                    .outputOptions('-pix_fmt yuv420p')
                    .output(videoPath)
                    .on('end', () => {
                        // Удаление временной директории с изображениями
                        fs.readdirSync(tempDir).forEach(file => {
                            fs.unlinkSync(path.join(tempDir, file));
                        });
                        fs.rmdirSync(tempDir);
                        console.log(`Presentation ${pdfPath} converted to video ${videoPath}`);
                        resolve();
                    })
                    .run();
            });
        });
    },

    // Функция для подсчета размера файла
    getSize(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return stats.size;
        } catch (error) {
            console.error('Error getting file size:', error);
            return null;
        }
    },

    // Функция для подсчета разрешения изображения
    getScreenResolution(filePath) {
        try {
            const metadata = fluent_ffmpeg.ffprobeSync(filePath);
            const width = metadata.streams[0].width;
            const height = metadata.streams[0].height;
            return { width, height };
        } catch (err) {
            console.error('Error getting video resolution:', err);
            return null;
        }
    },

    // Функция изменения размеров видео или изображения
    async resizeImageOrVideo(file_path, file_name_with_format, new_width, new_height) {
        const pathToSource = path.join(file_path, `temp_${file_name_with_format}`);
        const pathToOutput = path.join(file_path, file_name_with_format);
        
        return new Promise((resolve, reject) => {
            fluent_ffmpeg(pathToSource)
                .outputOptions([
                    `-vf scale=${new_width}:${new_height}`,
                    '-c:a copy' // сохранить аудио без изменений
                ])
                .output(pathToOutput)
                .on('end', () => {
                    console.log('Image resized successfully');
                    // Удаляем исходный файл
                    fs.unlink(pathToSource, (err) => {
                        if (err) {
                            console.error('Error deleting source file:', err);
                            reject()
                        } else {
                            console.log('Source file deleted successfully');
                            resolve();
                        }
                    });
                })
                .on('error', (err) => {
                    console.error('Error resizing image:', err);
                    reject();
                })
                .run();
        });
    },

    getSeconds(videoPath) {
        const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        const output = child_process.execSync(command, { encoding: 'utf8' });
        const durationSeconds = parseFloat(output.trim());
        return durationSeconds;
    }
};

const fmpt = {

    // TODO функция трансляции с получением процесса
    streamVideo(full_file_path) {
        const args = ['-re', '-i', full_file_path, '-c', 'copy', '-f', 'flv', config.rtmp_url];
        const process = child_process.spawn('ffmpeg', args);
        console.log(`process ${process}`);
        return process;
    },

    // Функция для прерывания работы процесса FFmpeg
    kill(process) {
        process.kill('SIGINT');
    }
};

module.exports = { fmp, fmpt };