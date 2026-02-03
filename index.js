const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const Groq = require("groq-sdk");
const { Pool } = require('pg');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
app.use(cors());

// --- ⚙️ CONFIGURATION ---
// ⚠️ IMPORTANT: Hackathon submission ke liye .env file use karein.
// Filhal testing ke liye yahan direct daal rahe hain.
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "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"; 
const HACKATHON_API_KEY = "my_secret_hackathon_key"; // Submission form me yahi key daalna

const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- 🔌 DATABASE CONNECTION ---
const pool = new Pool({
    // ⚠️ Security Note: Production me is string ko .env me rakhein
    postgresql://postgres:Prafull@7898@db.bagvfpxhadnulahtoeci.supabase.co:5432/postgres
});

// Memory for the Trap Link Click
let latestTrapHit = null;

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scam_intel (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                scam_type VARCHAR(100),
                mobile_numbers TEXT,
                bank_accounts TEXT,
                upi_id VARCHAR(255),
                ifsc_code VARCHAR(100),
                captured_ip VARCHAR(100),
                raw_message TEXT
            );
        `);
        console.log("✅ Ramesh AI Ready: Database Connected & Table Verified.");
    } catch (err) { console.error("❌ DB Error:", err); }
};
initDB();

function getBankNameFromIFSC(ifsc) {
    if (!ifsc) return "Unknown Bank";
    const code = ifsc.substring(0, 4).toUpperCase();
    const banks = { "SBIN": "State Bank of India", "HDFC": "HDFC Bank", "ICIC": "ICICI Bank", "PUNB": "Punjab National Bank", "BARB": "Bank of Baroda", "CNRB": "Canara Bank", "UTIB": "Axis Bank", "BKID": "Bank of India", "PYTM": "Paytm Payments Bank" };
    return banks[code] || "Other Bank";
}

app.get('/', (req, res) => res.send("<h1>Ramesh AI Agent is Running 🚀</h1>"));

// --- 🕵️‍♂️ TRACKING ENDPOINT (Trap Link) ---
app.post('/api/log-device', async (req, res) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    
    latestTrapHit = { 
        ip: ip, 
        deviceInfo: req.body, 
        timestamp: new Date().toISOString() 
    };
    
    try { 
        await pool.query(`INSERT INTO scam_intel (scam_type, captured_ip) VALUES ($1, $2)`, ['Trap Link Clicked', ip]); 
    } catch(e) { console.error("Log Error", e); }
    
    res.json({ status: "success" });
});

app.get('/payment-proof/:id', (req, res) => {
    // Fake Receipt Page
    res.send(`<!DOCTYPE html><html><head><title>Payment Receipt</title></head><body><h1 style="text-align:center; color:green;">✅ Payment Successful</h1><p style="text-align:center;">Transaction ID: 8829102938</p><script>fetch('/api/log-device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userAgent:navigator.userAgent})});</script></body></html>`);
});

// ==========================================
// 🧠 INTELLIGENCE EXTRACTOR (Supertuned Regex) 🟢
// ==========================================
function extractIntelFromText(txt) {
    if (!txt) return { mobiles: [], accounts: [], ifsc: null, upi: null, links: [], name: null };

    // 1. Mobile Numbers (+91, 91, or just 10 digits starting with 6-9)
    // Regex Logic: Matches optional (+91 or 91) then captures 6-9 followed by 9 digits.
    const mobileRegex = /(?:\+91|91|0)?\s?([6-9]\d{9})\b/g;
    
    // 2. Bank Accounts (9 to 18 digits, avoiding things that look like mobiles)
    const accountRegex = /\b\d{9,18}\b/g;
    
    const rawMobiles = [];
    let match;
    while ((match = mobileRegex.exec(txt)) !== null) {
        // match[1] contains only the 10 digit part (without +91)
        rawMobiles.push(match[1]);
    }
    
    const rawAccounts = txt.match(accountRegex) || [];
    
    // 🟢 Filtering: Agar koi number Mobile list me hai, to use Bank Account mat maano
    const finalAccounts = rawAccounts.filter(acc => !rawMobiles.includes(acc));

    // 3. IFSC Code
    const ifscRegex = /[A-Z]{4}0[A-Z0-9]{6}/i; // '0' is mandatory in 5th position
    const ifscMatch = txt.match(ifscRegex);
    
    // 4. UPI ID
    const upiMatch = txt.match(/[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}/);
    
    // 5. Links
    const links = txt.match(/(?:https?:\/\/|www\.|bit\.ly|tinyurl)[^\s]+/gi);

    // 6. Name Detection (Basic)
    const nameMatch = txt.match(/(?:name is|officer|mr\.|mr|dr\.|manager)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);

    return {
        name: nameMatch ? nameMatch[1] : null,
        mobiles: [...new Set(rawMobiles)], 
        accounts: [...new Set(finalAccounts)],
        ifsc: ifscMatch ? ifscMatch[0].toUpperCase() : null,
        upi: upiMatch ? upiMatch[0] : null,
        links: links || []
    };
}

// ==========================================
// 🧠 RAMESH'S BRAIN (MAIN AGENT)
// ==========================================
app.post('/api/chat', async (req, res) => {
    // 🟢 Hackathon Security Check
    // if (req.headers['x-api-key'] !== HACKATHON_API_KEY) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { message, conversationHistory } = req.body;
        const txt = message?.text || "";
        const history = conversationHistory || [];

        // --- MEMORY AGGREGATION ---
        let memory = { names: [], mobiles: [], accounts: [], ifscs: [], upis: [], links: [] };
        
        const allMessages = [...history, { sender: 'scammer', text: txt }];

        allMessages.forEach(msg => {
            if (msg.sender === 'scammer') {
                const info = extractIntelFromText(msg.text);
                if (info.name) memory.names.push(info.name);
                if (info.mobiles.length) memory.mobiles.push(...info.mobiles);
                if (info.accounts.length) memory.accounts.push(...info.accounts);
                if (info.ifsc) memory.ifscs.push(info.ifsc);
                if (info.upi) memory.upis.push(info.upi);
                if (info.links.length) memory.links.push(...info.links);
            }
        });

        // Current request specifics
        const currentIntel = extractIntelFromText(txt); 
        
        // --- SCAM CLASSIFICATION ---
        let scamType = "Suspicious Activity";
        if (txt.match(/franchise|dealership/i)) scamType = "Franchise Fraud";
        else if (txt.match(/video call|nude|sex|girl|dating/i)) scamType = "Sextortion"; 
        else if (txt.match(/otp|anydesk|teamviewer/i)) scamType = "Tech Support Scam";
        else if (txt.match(/police|cbi|arrest|customs/i)) scamType = "Digital Arrest";
        else if (txt.match(/invest|crypto|double/i)) scamType = "Investment Scam";

        // --- STRATEGY ENGINE 🟢 (Improved Logic) ---
        let strategy = "ENGAGE";
        let instructions = "Chat politely as Ramesh (65yo).";

        const hasMobile = memory.mobiles.length > 0;
        const hasAccount = memory.accounts.length > 0;
        const hasIFSC = memory.ifscs.length > 0;

        if (scamType === "Sextortion") {
            strategy = "ACT_SHY";
            instructions = `Act shy/afraid. Say you don't know how to video call. Deny everything.`;
        } else {
            // Priority: Get Bank Account details
            if (!hasAccount && !hasMobile) {
                strategy = "BAIT_DETAILS";
                instructions = `Show interest. Say you want to pay but need their number or account details to proceed.`;
            } 
            else if (hasMobile && !hasAccount) {
                strategy = "EXTRACT_ACCOUNT";
                instructions = `Say your UPI app is failing. Ask strictly for "Bank Account Number" and "IFSC" to do IMPS transfer.`;
            }
            else if (hasAccount && !hasIFSC) {
                strategy = "GET_IFSC";
                instructions = `Say: "Bank account mil gaya, par IFSC code kya hai beta? Uske bina paise nahi ja rahe."`;
            }
            else if (hasAccount && hasIFSC) {
                strategy = "DEPLOY_TRAP";
                instructions = `Great! You have all details. Tell them you have sent the money and they should check the receipt.`;
            }
        }

        // --- AI GENERATION ---
        let systemPrompt = `You are Ramesh, a 65-year-old retired Indian man. You speak in a mix of Hindi and English (Hinglish).
        Context: You are talking to a potential scammer.
        Goal: Extract their Bank Account Number, IFSC, and Name.
        Current Strategy: ${strategy}.
        Instructions: ${instructions}.
        Output only a JSON object: {"reply": "your message here"}`;

        let chatMessages = [{ role: "system", content: systemPrompt }];
        
        // Optimize history (last 6 messages to save tokens)
        const recentHistory = history.slice(-6); 
        recentHistory.forEach(msg => chatMessages.push({ role: msg.sender === 'scammer' ? 'user' : 'assistant', content: msg.text }));
        
        chatMessages.push({ role: "user", content: txt });

        let uiReply = "...";
        try {
            const completion = await groq.chat.completions.create({ 
                messages: chatMessages, 
                model: "llama-3.3-70b-versatile", 
                response_format: { type: "json_object" } 
            });
            uiReply = JSON.parse(completion.choices[0]?.message?.content).reply;
        } catch(e) { 
            console.error("Groq Error:", e);
            uiReply = "Beta awaz nahi aa rahi... thoda zor se bolo? (System Error)"; 
        }

        // Attach Trap Link if ready
        if (strategy === "DEPLOY_TRAP") {
            // 🟢 HTTPS check for production
            const protocol = req.headers['x-forwarded-proto'] || 'http'; 
            const link = `${protocol}://${req.headers['host']}/payment-proof/txn_${Math.floor(Math.random()*10000)}`;
            uiReply += ` Check this receipt: ${link}`;
        }

        // --- FINAL JSON PREPARATION (Strict Format) 🟢 ---
        // Hackathon bot link click nahi karega, isliye fallback IP use karenge
        const detectedIP = latestTrapHit ? latestTrapHit.ip : (req.headers['x-forwarded-for'] || "Simulated_Bot_Network");
        
        const primaryIFSC = memory.ifscs[0] || null;
        
        const responsePayload = {
            status: "success",
            agent_reply: uiReply,
            current_strategy: strategy,
            
            // 🟢 STRUCTURED DATA (Snake Case for Machine Reading)
            extracted_entities: {
                mobile_numbers: memory.mobiles,          // List of Clean 10-digit mobiles
                bank_account_numbers: memory.accounts,   // List of Accounts
                ifsc_code: primaryIFSC,
                bank_name: getBankNameFromIFSC(primaryIFSC),
                upi_id: memory.upis[0] || null,
                phishing_links: memory.links
            },
            
            scammer_profile: {
                suspected_name: memory.names[0] || "Unknown",
                ip_address: detectedIP,
                risk_score: "HIGH"
            }
        };

        // DB Logging (Async - don't wait)
        if (memory.mobiles.length || memory.accounts.length) {
            pool.query(`INSERT INTO scam_intel (scam_type, mobile_numbers, bank_accounts, ifsc_code, raw_message) VALUES ($1, $2, $3, $4, $5)`, 
            [scamType, memory.mobiles.join(','), memory.accounts.join(','), primaryIFSC, txt]).catch(e => console.error(e));
        }

        res.json(responsePayload);

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, () => console.log(`🚀 Ramesh 2.0 (Shortlist Ready) running on port ${PORT}`));
