const nodemailer = require("nodemailer");
const { Telegraf } = require('telegraf');
const HttpsProxyAgent = require('https-proxy-agent');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

// download image from url and save to filepath using proxy
async function downloadImage(url, filepath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        proxy: {
            protocol: 'http',
            host: process.env.HTTP_PROXY_HOST, //proxy server name e.g. http://proxy_server.domain.com
            port: process.env.HTTP_PROXY_PORT // proxy port e.g. 3128
        }
    });
    return new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(filepath))
            .on('error', reject)
            .once('close', () => resolve(filepath)); 
    });
}

async function createEmail(subjectName) {
    // send e-mail after a delay with all images at once
    if (photosToSend.length != 0) {
        // send mail with defined transport object
        await transporter.sendMail({
            from: process.env.MAIL_USER, // sender address user@mail.com
            to: process.env.MAIL_RECEPIENT, // list of receivers
            subject: subjectName, // Subject line
            text: "This is an automated message from telegram bot", // plain text body
            attachments: photosToSend
            // post-send cleanup
        }).then(photosToSend.length = 0) // mail sent, clearing sending queue
        .then(await delay(500)) // waiting for email to be sent
        .then(filesToDelete.forEach(item => fs.unlinkSync(item))) // deleting files from temp directory
        filesToDelete.length = 0; // files deleted, clearing files queue
        
        return Promise.resolve("Mail sent")
    }else{
        return Promise.reject("File queue is empty");
    }
}

// create reusable transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST, // IP address of the SMTP server
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.MAIL_SENDER, // Sender's mail address user@mail.com
      pass: process.env.MAIL_PASSWORD, // Sender's mail password
    },
	tls: {
		minVersion: 'TLSv1', // compatibility option for older SMTP servers
		rejectUnauthorized: false
	}
});

// creating Delay function to catch all sent images before
// sending an e-mail
function delay(time) {
    return new Promise(resolve =>  setTimeout(resolve, time));
}

// global arrays to asynchronously download and delete files
const photosToSend = [];
const filesToDelete = [];

function fillArrays(fileName, filePath) {
    photosToSend.push({ filename: fileName, path: filePath }); // fill attachments list
    filesToDelete.push(filePath); // files to be deleted after send
}

// connecting to telegram services through proxy
const bot = new Telegraf(process.env.BOT_TOKEN,{
    telegram: {
        //utilizing Telegraf's native proxy support providing proxy address and port
        agent: new HttpsProxyAgent(process.env.HTTP_PROXY_HOST + ':' + process.env.HTTP_PROXY_PORT)
    }
});

bot.start((ctx) => ctx.reply('Welcome'));
bot.hears('hi', (ctx) => ctx.reply('Hello there!'));
bot.on('photo', async (ctx) => {
    ctx.telegram.getFileLink(ctx.message.photo[3].file_id).then(async url => {
        // creating file path with a name given by Telegram
        const fileName = url.href.substring(url.href.lastIndexOf('file'));
        // specifying file path for temporary file storage
        const filePath = process.env.FILE_STORAGE + fileName;

        // downloading image and saving it to temp folder
        downloadImage(url.href, filePath)
        .then(fillArrays(fileName, filePath)) 
        .then(await delay(500)) // wait for other images if sent as a group
        .then(
            // make email attach all downloaded images clear queue
            createEmail(ctx.message.from.last_name + " " + ctx.message.from.first_name)
            .then(result => ctx.reply(result)) // Messaging response to Telegram
            .catch(err => console.log()) // Workaround to empty photosToSend array from multiple images
        )
    });
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));