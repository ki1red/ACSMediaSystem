const child_process = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require(path.join(__dirname, '..', 'libs', 'configs')).cffmpeg_config;

const fmp = {
    // Функция для преобразования изображения в видео
    async imageToVideo(imagePath, videoPath, seconds, width, height) {
        return new Promise((resolve, reject) => {
            const tempDir = path.join(__dirname, '..', 'uploads', `temp_${new Date().getTime()}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }
    
            const imageOutput = path.join(tempDir, 'image.png');
            fs.copyFileSync(imagePath, imageOutput);
    
            const ffmpegFlags = [
                '-loop', '1',
                '-i', imageOutput,
                '-c:v', 'libx264',
                '-t', seconds,
                '-vf', 'fps=60',
                '-pix_fmt', 'yuv420p',
                "-vf", `scale=${width}:${height}`,
                '-movflags', 'faststart',
                videoPath
            ];
    
            const ffmpegProcess = child_process.spawn('ffmpeg', ffmpegFlags);
    
            ffmpegProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`ffmpeg process exited with code ${code}`));
                    return;
                }
    
                fs.unlinkSync(imageOutput);
                fs.rmdirSync(tempDir);
                console.log(`Image ${imagePath} converted to video ${videoPath}`);
                resolve();
            });
    
            ffmpegProcess.on('error', (err) => {
                console.error('Error converting image to video:', err.message);
                reject(err);
            });
        });
    },
    
    async presentationToVideo(pdfPath, videoPath, seconds, width, height) {
        return new Promise((resolve, reject) => {
            // Создание временной директории для изображений
            const tempDir = path.join(__dirname, '..', 'uploads', `temp_${new Date().getTime()}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }
    
            const imageOutput = path.join(tempDir, 'image');
            const magickFlags = [
                '-png',
                '-scale-to-x', width,
                '-scale-to-y', height,
                pdfPath,
                imageOutput];
            const magickProcess = child_process.spawn('pdftoppm', magickFlags);
            magickProcess.on("close", () => {
                const files = fs.readdirSync(tempDir);
                
                // Переименовываем файлы и подсчитываем количество изображений
                files.forEach((file, index) => {
                    const oldPath = path.join(tempDir, file);
                    const newPath = path.join(tempDir, `image-${index.toString().padStart(2, '0')}.png`);
                    fs.renameSync(oldPath, newPath);
                });

                // Обновляем значение seconds
                seconds = seconds / files.length;
    
                const ffmpegFlags = [
                    "-r", 1 / seconds,
                    "-i", `${imageOutput}-%02d.png`,
                    "-c:v", "libx264",
                    "-r", "60",
                    "-pix_fmt", "yuv420p",
                    "-vf", `scale=${width}:${height}`,
                    videoPath];
                const ffmpegProcess = child_process.spawn('ffmpeg', ffmpegFlags);
    
                ffmpegProcess.on("close", () => {
                    fs.readdirSync(tempDir).forEach(file => {
                        fs.unlinkSync(path.join(tempDir, file));
                    });
                    fs.rmdirSync(tempDir);
                    console.log(`Presentation ${pdfPath} converted to video ${videoPath}`);
                    resolve();
                });
            });
        });
    },

    // Функция для подсчета размера файла
    getSize(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return stats.size;
        } catch (error) {
            console.error('Error getting file size:', error.message);
            return null;
        }
    },

    // Функция изменения размеров видео или изображения
    async resizeImageOrVideo(file_path, file_name_with_format, new_width, new_height) {
        const pathToSource = path.join(file_path, `temp_${file_name_with_format}`);
        const pathToOutput = path.join(file_path, file_name_with_format);

        return new Promise((resolve, reject) => {
            const ffmpegArgs = [
                '-i', pathToSource,
                '-vf', `scale=${new_width}:${new_height}`,
                '-c:a', 'copy',
                pathToOutput
            ];

            const ffmpegProcess = child_process.spawn('ffmpeg', ffmpegArgs);

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('Image resized successfully');
                    // Удаляем исходный файл
                    fs.unlink(pathToSource, (err) => {
                        if (err) {
                            console.error('Error deleting source file:', err.message);
                            reject(err);
                        } else {
                            console.log('Source file deleted successfully');
                            resolve();
                        }
                    });
                } else {
                    reject(new Error(`ffmpeg process exited with code ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                console.error('Error resizing image:', err.message);
                reject(err);
            });
        });
    },

    getSeconds(videoPath) {
        const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        const output = child_process.execSync(command, { encoding: 'utf8' });
        const durationSeconds = parseFloat(output.trim());
        return durationSeconds;
    },

    async generateRandomFrames(videoPath, file_name, outputDir, seconds, num_frames = 3) {
        try {
            // Создаем директорию, если она не существует
            const dirPath = path.join(outputDir, file_name);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
    
            // Генерируем случайные временные метки для кадров
            const timestamps = Array.from({ length: num_frames }, () => Math.floor(Math.random() * seconds));
    
            // Создаем и выполняем команды ffmpeg асинхронно
            await Promise.all(timestamps.map(async (timestamp, index) => {
                const command = `ffmpeg -i "${videoPath}" -ss ${timestamp} -vframes 1 "${path.join(dirPath, `frame_${index}.jpg`)}" -y`;
                await new Promise((resolve, reject) => {
                    child_process.exec(command, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            console.log(`Frame ${index} generated for ${file_name}`);
                            resolve();
                        }
                    });
                });
            }));
    
            console.log(`Random frames generated successfully for ${file_name}`);
        } catch (error) {
            console.error(error);
        }
    }
};

const fmpt = {

    streamVideo(full_file_path) {
        const args = [
            '-re',
            '-i', full_file_path,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-g', '30',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'flv',
            config.rtmp_url
          ];
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