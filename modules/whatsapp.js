// whatsapp-web.js / puppeteer are heavy — required lazily in initWhatsApp() so app start stays fast
const path = require('path');

let client;
let isReady = false;
let browserWindow;
let lastSentMessage = null;
let currentQR = null;

function initWhatsApp(mainWindow) {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    browserWindow = mainWindow;

    console.log('[WhatsApp] Initializing client...');
    
    const sessionPath = path.join(__dirname, '..', 'whatsapp-session');

    // Use LocalAuth to save session so the user doesn't have to scan QR every time
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionPath }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', async (qr) => {
        console.log('[WhatsApp] QR code generated. Waiting for scan...');
        try {
            const qrDataUrl = await require('qrcode').toDataURL(qr);
            currentQR = qrDataUrl;
            if (browserWindow) {
                browserWindow.webContents.send('whatsapp-qr', qrDataUrl);
            }
        } catch (err) {
            console.error('[WhatsApp] Error generating QR code image:', err);
        }
    });

    client.on('ready', () => {
        console.log('[WhatsApp] Client is ready!');
        isReady = true;
        if (browserWindow) {
            browserWindow.webContents.send('whatsapp-ready');
        }
    });

    client.on('authenticated', () => {
        console.log('[WhatsApp] Authenticated successfully!');
    });

    client.on('auth_failure', msg => {
        console.error('[WhatsApp] Authentication failure:', msg);
    });

    client.on('disconnected', (reason) => {
        console.log('[WhatsApp] Client was logged out:', reason);
        isReady = false;
        if (browserWindow) {
            browserWindow.webContents.send('whatsapp-disconnected');
        }
    });

    client.initialize().catch(err => {
        console.error('[WhatsApp] Initialization error:', err);
    });
}

/**
 * Searches for a contact by name and sends them a message.
 */
async function sendMessage(contactName, messageText) {
    if (!isReady || !client) {
        throw new Error('WhatsApp is not ready. Please scan the QR code first.');
    }

    console.log(`[WhatsApp] Searching for contact: ${contactName}`);
    
    // Get all contacts
    const contacts = await client.getContacts();
    
    // Simple search (case-insensitive)
    const nameLower = contactName.toLowerCase();
    
    // Prefer an exact name match, then a single partial match. Refuse to guess between several.
    const mine = contacts.filter(c => c.isMyContact && (c.name || c.pushname));
    const nameOf = c => (c.name || c.pushname || '').toLowerCase();
    let match = mine.find(c => nameOf(c) === nameLower);
    if (!match) {
        const partial = mine.filter(c => nameOf(c).includes(nameLower));
        if (partial.length > 1) {
            const names = partial.slice(0, 5).map(c => c.name || c.pushname).join(', ');
            throw new Error(`Multiple contacts match '${contactName}': ${names}. Ask Vivek which one.`);
        }
        match = partial[0];
    }

    if (!match) {
        throw new Error(`Contact '${contactName}' not found in your WhatsApp contacts.`);
    }

    console.log(`[WhatsApp] Found contact: ${match.name || match.pushname} (${match.id._serialized})`);
    
    const chatId = match.id._serialized;
    lastSentMessage = await client.sendMessage(chatId, messageText);
    
    console.log(`[WhatsApp] Message sent to ${match.name || match.pushname}`);
    return `Message successfully sent to ${match.name || match.pushname} via WhatsApp.`;
}

async function deleteLastWhatsAppMessage() {
    if (!lastSentMessage) {
        throw new Error('No recent message to delete.');
    }
    
    console.log('[WhatsApp] Deleting last sent message...');
    await lastSentMessage.delete(true); // true = delete for everyone
    lastSentMessage = null;
    return 'Message deleted successfully.';
}

/**
 * Send a file (e.g. the timetable .ics) to your own "Message yourself" chat.
 */
async function sendFileToSelf(filePath, caption) {
    if (!isReady || !client) {
        throw new Error('WhatsApp is not connected. Link it in the WhatsApp tab first, or use "Save file" instead.');
    }
    const { MessageMedia } = require('whatsapp-web.js');
    const media = MessageMedia.fromFilePath(filePath);
    const selfId = client.info.wid._serialized;
    await client.sendMessage(selfId, media, { sendMediaAsDocument: true, caption });
    return 'File sent to your own WhatsApp chat.';
}

function getWhatsAppState() {
    return {
        state: isReady ? 'connected' : (client ? 'waiting' : 'disconnected'),
        qr: currentQR
    };
}

async function logoutWhatsApp() {
    console.log('[WhatsApp] Initiating logout...');
    if (client) {
        try {
            // client.logout() removes session from whatsapp and local
            await client.logout();
            console.log('[WhatsApp] Logged out successfully.');
        } catch (e) {
            console.error('[WhatsApp] Logout error (might already be disconnected):', e);
        }
        
        try {
            await client.destroy();
        } catch (e) {
            console.error('[WhatsApp] Destroy error:', e);
        }
        
        client = null;
        isReady = false;
        
        // Re-initialize to fetch new QR code
        setTimeout(() => {
            initWhatsApp(browserWindow);
        }, 1000);
    }
}

module.exports = {
    initWhatsApp,
    sendMessage,
    getWhatsAppState,
    logoutWhatsApp,
    deleteLastWhatsAppMessage,
    sendFileToSelf
};
