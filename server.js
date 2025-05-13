const http = require('http');
const https = require('https');
const querystring = require('querystring');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const {client_id, client_secret, scope, gemini_key} = require('./auth/credentials.json');

const PORT = 3000;
const HOST = 'localhost';
const redirect_uri = `http://${HOST}:${PORT}/oauth/callback`;

const taskList = []

const server = http.createServer();

server.on('listening', listen_handler)
server.on('request', request_handler)
server.listen(PORT);

function listen_handler(){
    console.log(`Now Listening on Port ${PORT}`);
    console.log(server.address());
    console.log(`Server running at: http://${HOST}:${PORT}`);
}

function request_handler(req, res){
    console.log(`new request: ${req.url}`);
    if (req.url === '/') {
        sendFormToUser(res);
    } else if (req.url.startsWith('/oauth/callback')) {
        getAccessTokenAndUpload(res);
    } else if (req.url.startsWith('/image')) {
        createImageTask(req, res);
    } else {
        notFound(res)
    }
}

function getAccessTokenAndUpload(req, res){
    // get code and verify state
    const { code, state } = url.parse(req.url, true).query;
    console.log("code: ", code, ", state: ", state);
    let task = taskList.find(task => task.state === state);
    if (!code || !state || !task) {
        notFound(res);
        return;
    }

    // request for access token
    requestAccessToken(code, getUsernameAndUpload, task, res);
}
function createImageTask(req,res){
    let input = url.parse(req.url, true).query;
    console.log(input);
    if (!input.prompt || !input.repo) {
        notFound(res);
        return;
    }

    requestOpenAIImage(input.prompt, input.repo, res);
}

function sendFormToUser(res){
    const form = fs.createReadStream('html/index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    form.pipe(res);
}

function requestOpenAIImage(prompt, repo, res){
    const requestData = JSON.stringify({
        contents: [
            {
                parts: [{ text: prompt }]
            }
        ],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
        }
    });

    const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: '/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=' + gemini_key,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestData)
        }
    };
    https.request(options, (data) => processStream(data, parseGeminiImageAndUpload, repo, res)).end(requestData);
}

function parseGeminiImageAndUpload(body, repo, res){
    try{
        const json = JSON.parse(body);
        const base64Image = json.candidates[0].content.parts[1].inlineData.data;
        getCodeFromGithub(base64Image, repo, res)
    } catch (e) {
        console.log(e);
    }
}

function getCodeFromGithub(img, repo, res){
    const state = createTask('Hello World');
    redirectToGithubAuth(state, res);
}

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

function processStream(stream, callback, ...args){
    let body = '';
    stream.on('data', chunk => (body += chunk));
    stream.on('end', () => callback(body, ...args));
}

function requestAccessToken(code, callback, task, res){
    const tokenData = querystring.stringify({
        client_id,
        client_secret,
        code,
        redirect_uri
    });

    const options = {
        hostname: 'github.com',
        path: '/login/oauth/access_token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(tokenData)
        }
    }
    const tokenReq = https.request(options,
        (tokenRes) => processStream(tokenRes, getUsernameAndUpload, task, res))
        .end(tokenData);

    tokenReq.on('error', err => error(res, err));
}

function createTask(img, repo) {
    let state = generateRandomString(16);
    taskList.push({img, repo, state });
    return state;
}

function getUsernameAndUpload(body, task, res) {
    const {access_token} = JSON.parse(body);
    const options = {
        hostname: 'api.github.com',
        path: '/user',
        method: 'GET',
        headers: {
            'User-Agent': 'node-oauth-app',
            'X-GitHub-Api-Version': '2022-11-28',
            'Authorization': `token ${access_token}`,
            'Accept': 'application/vnd.github+json'
        }
    };
    const req = https.request(options,
        (userData) => processStream(userData, uploadFile, access_token, task, res));

    req.on('error', err => error(res, err));
    req.end();
}

function redirectToGithubAuth(state, res){
    const authEndpoint = `https://github.com/login/oauth/authorize`;
    const uri = querystring.stringify({client_id, redirect_uri, state, scope});
    const authURL = `${authEndpoint}?${uri}`;
    console.log('authURL', authURL);
    res.writeHead(302, { Location: authURL });
    res.end();
}


function uploadFile(body, token, task, res) {
    const {repo, img, state} = task;
    const filename = state + '.png';
    const {login} = JSON.parse(body)

    const data = JSON.stringify({
        message: `Upload img ${filename}`,
        content: img,
        branch: 'main'
    });

    const options = {
        hostname: 'api.github.com',
        path: `/repos/${login}/${repo}/contents/images/${filename}`,
        method: 'PUT',
        headers: {
            'User-Agent': 'node-oauth-app',
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }
    };

    const req = https.request(options,
        (githubRes) => processStream(githubRes, handleUploadRes, img, res));

    req.on('error', err => error(res, err));
    req.write(data);
    req.end();

}

function handleUploadRes(body, img, res) {
    console.log('upload message:', body)
    if (body.message === 'Not Found') {
        notFound(res);
        return;
    }
    res.writeHead(200, {"Content-Type": "text/html"});
    res.write(`<h1>Following image is uploaded</h1>`);
    res.write(`<pre>Location: ${body}</pre>`);
    res.write(`<img src="data:image/png;base64,${img}" alt="Generated Img"/>`);
    res.end();
}

function notFound(res){
    res.writeHead(404, {"Content-Type": "text/html"});
    res.end(`<h1>404 Not Found</h1>`);
}

function error(res, err){
    res.writeHead(500, {"Content-Type": "text/html"});
    res.write(`<h1>500 Internal Server Error</h1>`);
    res.end(`<p>message: ${err}</p>`);
}