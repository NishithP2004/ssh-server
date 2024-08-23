require("dotenv").config()
const ngrok = require("ngrok")

async function createTunnel(port=22) {
    const url = await ngrok.connect({
        proto: "tcp",
        addr: port
    })

    const formattedUrl = new URL(url)
    const cmd = `ssh root@${formattedUrl.hostname} -p ${formattedUrl.port}`
    console.log(cmd)
    const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: cmd
        })
    })

    if (res.ok) {
        console.log("URL successfully delivered to the Discord Webhook.");
    } else {
        console.error("Failed to send the URL to the Discord Webhook.");
    }    
}

module.exports = {
    createTunnel
}