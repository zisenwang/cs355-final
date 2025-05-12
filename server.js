const http = require('http');
const https = require('https');
const querystring = require('querystring');
const url = require('url');
const crypto = require('crypto');
const {client_id, client_secret, scope} = require('./auth/credentials.json');

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
    if (req.url === '/') {
        // create task and get user authorization
        const state = createTask('Hello World');
        redirectToGithubAuth(state, res);

    } else if (req.url.startsWith('/oauth/callback')) {
        // get code and verify state
        const { code, state } = url.parse(req.url, true).query;
        console.log("code: ", code, ", state: ", state);
        let task = taskList.find(task => task.state === state);
        if (!code || !state || !task) {
            notFound(res);
            return;
        }

        // request for access token
        requestAccessToken(code, getUsernameAndUpload, res);

    } else {
        notFound(res)
    }
}

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

function processStream(stream, callback, ...args){
    let body = '';
    stream.on('data', chunk => (body += chunk));
    stream.on('end', () => callback(body, ...args));
}

function requestAccessToken(code, callback, res){
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
        (tokenRes) => processStream(tokenRes, getUsernameAndUpload, res))
        .end(tokenData);

    tokenReq.on('error', err => error(res, err));
}

function createTask(task) {
    let state = generateRandomString(16);
    taskList.push({task, state});
    return state;
}

function getUsernameAndUpload(body, res) {
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
        (data) => processStream(data, uploadFile, access_token, res));

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


function uploadFile(body, token, res) {
    const repo = 'test-upload-repo'; // 你要上传到的 repo
    const path = 'hello.txt';
    const content = Buffer.from('Hello from OAuth app!').toString('base64');
    const {login} = JSON.parse(body)

    const data = JSON.stringify({
        message: 'add hello.txt',
        content,
        branch: 'main'
    });

    const options = {
        hostname: 'api.github.com',
        path: `/repos/${login}/${repo}/contents/${path}`,
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

    const req = https.request(options, githubRes => {
        let body = '';
        githubRes.on('data', chunk => (body += chunk));
        githubRes.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Upload success!</h1><pre>' + body + '</pre>');
        });
    });

    req.on('error', err => error(res, err));
    req.write(data);
    req.end();

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