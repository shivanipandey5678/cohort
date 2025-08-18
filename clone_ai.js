require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const prompt = require('prompt-sync')();
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Jo assets/download ho chuke, unko store karo
const downloaded = new Set();

function urlJoin(base, relative) {
    try { return new URL(relative, base).href; } catch { return relative; }
}

function sanitizeFilename(url) {
    return url.replace(/[\/\\?%*:|"<>]/g, '_');
}

function getLocalFilePath(baseDir, url) {
    let parsed = new URL(url);
    let pathname = parsed.pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    return path.join(baseDir, pathname);
}

// Links/assets ko local bana ke html me dal do
function rewriteLinks(html, baseUrl, baseDir) {
    const $ = cheerio.load(html);

    $('img,script,link').each((_, elem) => {
        let attr = elem.tagName === 'img' ? 'src' : (elem.tagName === 'script' ? 'src' : 'href');
        let link = $(elem).attr(attr);
        if (!link || link.startsWith('data:') || link.startsWith('mailto:')) return;
        let absUrl = urlJoin(baseUrl, link);
        let localPath = path.relative(baseDir, getLocalFilePath(baseDir, absUrl)).replace(/\\/g, '/');
        $(elem).attr(attr, localPath);
    });

    $('a').each((_, elem) => {
        let href = $(elem).attr('href');
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
        let absUrl = urlJoin(baseUrl, href);
        let localPath = path.relative(baseDir, getLocalFilePath(baseDir, absUrl)).replace(/\\/g, '/');
        $(elem).attr('href', localPath);
    });

    return $.html();
}

async function downloadFile(url, filepath) {
    if (downloaded.has(url)) return;
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        await fs.outputFile(filepath, res.data);
        downloaded.add(url);
    } catch (err) {
        if (error.response && error.response.status === 402) {
            console.log(`[WARN] 402 Payment Required for ${url}. Skipping this resource.`);
        } else {
            console.log({"error in downloading": error});
        }
    }
}

async function crawl(url, baseDir, visited=new Set()) {
    if (visited.has(url)) return;
    visited.add(url);
    let localPath = getLocalFilePath(baseDir, url);

    try {
        const res = await axios.get(url);
        let html = res.data;
        await fs.outputFile(localPath, html);

        let $ = cheerio.load(html);

        // Download all assets
        let assets = [];
        $('img,script,link').each((_, elem) => {
            let attr = elem.tagName === 'img' ? 'src' : (elem.tagName === 'script' ? 'src' : 'href');
            let link = $(elem).attr(attr);
            if (!link || link.startsWith('data:') || link.startsWith('mailto:')) return;
            let absUrl = urlJoin(url, link);
            let assetPath = getLocalFilePath(baseDir, absUrl);
            assets.push({ absUrl, assetPath });
        });

        await Promise.all(assets.map(a => downloadFile(a.absUrl, a.assetPath)));

        // Recursive crawl internal links
        let crawlPromises = [];
        $('a').each((_, elem) => {
            let href = $(elem).attr('href');
            if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
            let absUrl = urlJoin(url, href);
            if (new URL(absUrl).hostname === new URL(url).hostname)
                crawlPromises.push(crawl(absUrl, baseDir, visited));
        });

        // Rewrite links
        let rewritten = rewriteLinks(html, url, baseDir);
        await fs.outputFile(localPath, rewritten);

        await Promise.all(crawlPromises);

    } catch(err) {
        console.log(`Error: ${url}`);
    }
}

async function aiEditFile(inputFile, userPrompt) {
    const code = await fs.readFile(inputFile, "utf-8");

    const systemMsg = {
        role: "system",
        content: "You are a helpful AI web developer. Given HTML/CSS/JS code and user request, return just the modified code as requested, no explanations."
    };

    const userMsg = {
        role: "user",
        content: `Below is a file's content that represents a web page. Please: ${userPrompt}\n\nFile:\n${code}`
    };

    const response = await openai.chat.completions.create({
        model: "gpt-4o", // Or "gpt-4-turbo"
        temperature: 0.4,
        max_tokens: 4096,
        messages: [systemMsg, userMsg]
    });

    let result = response.choices[0].message.content.trim();
    await fs.writeFile(inputFile, result, "utf-8");
    console.log("AI modification applied successfully!\n");
}

async function main() {
    const url = process.argv[2] || prompt('Enter website URL to clone: ');

    if (!url) return console.log('No URL provided.');

    let sitename = new URL(url).hostname.replace(/\W+/g, '_');
    let baseDir = path.join('cloned_sites', sitename);

    console.log(`\nCloning ${url} into "${baseDir}" ...`);
    await crawl(url, baseDir);
    console.log('\nCloning complete!');

    // Select file to AI-edit (default index.html)
    const mainFile = getLocalFilePath(baseDir, url);

    let keepEditing = true;
    while (keepEditing) {
        const wantAiEdit = prompt('\nDo you want AI to edit/modernize any local page? (y/n) ');
        if (wantAiEdit.toLowerCase() === 'y') {
            const userPrompt = prompt('\nDescribe your edit (ex: “make navbar sticky and buttons rounded, change color scheme to blue”):\n> ');
            await aiEditFile(mainFile, userPrompt);
            console.log('Edit complete! Open index.html locally to check. You can apply more edits if needed.');
        } else {
            keepEditing = false;
            console.log('Done! Open index.html locally in your browser.');
        }
    }
    
}

main();

