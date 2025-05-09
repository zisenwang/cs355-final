const http = require('http');
const https = require('https');
const querystring = require('querystring');

const PORT = 3000;

// 创建服务器
const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
        // 访问主页，返回HTML表单
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
      <html>
        <body>
          <form method="POST" action="/">
            <input name="keyword" placeholder="Enter a keyword" required>
            <button type="submit">Search</button>
          </form>
        </body>
      </html>
    `);
    } else if (req.method === 'POST') {
        // 处理表单提交
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            const formData = querystring.parse(body);
            const keyword = formData.keyword;

            // 现在你拿到了用户输入的keyword，可以开始发第一个API请求了
            console.log('Received keyword:', keyword);

            // ===== 第一个API请求示例 =====
            const api1Options = {
                hostname: 'api.example.com',  // 这里改成你的API地址
                path: `/search?q=${encodeURIComponent(keyword)}`,
                method: 'GET'
            };

            const api1Req = https.request(api1Options, api1Res => {
                let api1Data = '';

                api1Res.on('data', chunk => {
                    api1Data += chunk;
                });

                api1Res.on('end', () => {
                    console.log('API 1 response:', api1Data);

                    // ===== 第二个API请求示例（依赖第一个API的结果） =====
                    const api2Options = {
                        hostname: 'api.example2.com',  // 这里改成你的第二个API地址
                        path: `/something?info=${encodeURIComponent(api1Data)}`,
                        method: 'GET'
                    };

                    const api2Req = https.request(api2Options, api2Res => {
                        let api2Data = '';

                        api2Res.on('data', chunk => {
                            api2Data += chunk;
                        });

                        api2Res.on('end', () => {
                            console.log('API 2 response:', api2Data);

                            // 最终把合并后的结果返回给浏览器
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`
                <html>
                  <body>
                    <h1>Results</h1>
                    <pre>${api2Data}</pre>
                    <a href="/">Search again</a>
                  </body>
                </html>
              `);
                        });
                    });

                    api2Req.on('error', error => {
                        console.error(error);
                    });

                    api2Req.end();
                });
            });

            api1Req.on('error', error => {
                console.error(error);
            });

            api1Req.end();
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
    }
});

// 启动服务器
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
