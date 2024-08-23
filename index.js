const {
    Server,
    utils: {
        parseKey,
        generateKeyPairSync
    }
} = require("ssh2");
const fs = require("node:fs");
const {
    timingSafeEqual
} = require("node:crypto");
const {
    spawn
} = require("child_process");
const {
    inspect
} = require("node:util");
const {
    createTunnel
} = require("./tunnel")

if (!fs.existsSync("./ssh_key.pub") || !fs.existsSync("./ssh_key.pem")) {
    const key = generateKeyPairSync("rsa", {
        bits: 4096,
        comment: "SSH key created using Node JS"
    });

    fs.writeFileSync("./ssh_key.pub", key.public);
    fs.writeFileSync("./ssh_key.pem", key.private);
}

function checkValue(input, allowed) {
    const autoReject = (input.length !== allowed.length);
    if (autoReject) {
        allowed = input;
    }
    const isMatch = timingSafeEqual(input, allowed);
    return (!autoReject && isMatch);
}

const allowedUser = Buffer.from("root");
const allowedPassword = Buffer.from("root");
const allowedPubKey = parseKey(fs.readFileSync("./ssh_key.pub", "utf-8"));

new Server({
    greeting: "Custom PowerShell over SSH",
    hostKeys: [fs.readFileSync("./host.key")]
}, (client) => {
    console.log('Client connected!');

    client.on('authentication', (ctx) => {
        let allowed = true;
        if (!checkValue(Buffer.from(ctx.username), allowedUser))
            allowed = false;

        switch (ctx.method) {
            case 'password':
                if (!checkValue(Buffer.from(ctx.password), allowedPassword))
                    return ctx.reject();
                break;
            case 'publickey':
                if (ctx.key.algo !== allowedPubKey.type ||
                    !checkValue(ctx.key.data, allowedPubKey.getPublicSSH()) ||
                    (ctx.signature && allowedPubKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true)) {
                    return ctx.reject();
                }
                break;
            default:
                return ctx.reject();
        }

        if (allowed)
            ctx.accept();
        else
            ctx.reject();
    }).on('ready', () => {
        console.log('Client authenticated!');

        client.on('session', (accept, reject) => {
            const session = accept();

            session.once('pty', (accept, reject, info) => {
                console.log('Client requested PTY:', info);
                accept();
            });

            session.once('shell', (accept, reject) => {
                console.log('Client requested a shell');
                const stream = accept();
                const ps = spawn('powershell.exe', [], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let commandBuffer = '';

                ps.stdout.on('data', (data) => {
                    stream.write(data.toString());
                });

                ps.stderr.on('data', (data) => {
                    stream.stderr.write(data.toString());
                });

                ps.on('close', (code) => {
                    if (stream.writable) {
                        stream.exit(code);
                        stream.end();
                    }
                });

                stream.on('data', (data) => {
                    const str = data.toString();

                    for (let char of str) {
                        if (char === '\r' || char === '\n') {
                            ps.stdin.write(commandBuffer + '\n');
                            commandBuffer = '';
                            stream.write(char);
                        } else if (char === '\u0008' || char === '\x7f') {
                            if (commandBuffer.length > 0) {
                                commandBuffer = commandBuffer.slice(0, -1);
                                stream.write('\b \b');
                            }
                        } else if (char >= ' ') {
                            commandBuffer += char;
                            stream.write(char);
                        }
                    }
                });

                stream.on('close', () => {
                    ps.stdin.end();
                    console.log('Shell stream closed');
                });

                stream.on('error', (err) => {
                    console.error('Stream error:', err);
                    ps.kill();
                });

                ps.on('error', (err) => {
                    console.error('Process error:', err);
                    if (stream.writable) {
                        stream.end();
                    }
                });
            });

            session.once('exec', (accept, reject, info) => {
                console.log('Client wants to execute: ' + inspect(info.command));
                const stream = accept();
                const ps = spawn('powershell.exe', [info.command], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                ps.stdout.on('data', (data) => {
                    stream.write(data.toString());
                });

                ps.stderr.on('data', (data) => {
                    stream.stderr.write(data.toString());
                });

                ps.on('close', (code) => {
                    if (stream.writable) {
                        stream.exit(code);
                        stream.end();
                    }
                });

                ps.on('error', (err) => {
                    console.error('Process error:', err);
                    if (stream.writable) {
                        stream.end();
                    }
                });

                stream.on('error', (err) => {
                    console.error('Stream error:', err);
                    ps.kill();
                });
            });
        });
    }).on('close', () => {
        console.log('Client disconnected');
    });
}).listen(22, '0.0.0.0', async function () {
    console.log('Listening on port ' + this.address().port);
    await createTunnel()
});