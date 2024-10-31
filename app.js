const express = require('express');
const fs = require('fs');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const path = require('path');
const https = require('https');

const app = express();
const port = 4350;
const version = '1.0.1';

const fileList = [];
const pickedFiles = [];
const pickedLocations = [];

//SSL
const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, './secret/_.bcnlab.org_private_key.key')),
    cert: fs.readFileSync(path.join(__dirname, './secret/bcnlab.org_ssl_certificate.cer')),
    ca: fs.readFileSync(path.join(__dirname, './secret/_.bcnlab.org_ssl_certificate_INTERMEDIATE.cer'))
};

//SERVER

// maximum of 30 requests per minute
const dailySetLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,  // 1 minute
    max: 10,                  // Limit in time window
    message: "Too many requests, please try again later."
});

//Apply limit
app.use('/dailyset', dailySetLimiter);
app.get('/dailyset', (req, res) => {
    const filePath = path.join(__dirname, './output/dailyset.json'); // Construct the file path

    // Check if the file exists
    fs.stat(filePath, (err, stats) => {
        if (err) {
            console.error("Error checking file:", err);
            return res.status(404).json({ error: "File not found." });
        }

        // Send the file for download
        res.download(filePath, 'dailyset.json', (err) => {
            if (err) {
                console.error("Error sending file:", err);
                return res.status(500).json({ error: "Failed to send file." });
            }
        });
    });
});

//GENERATION

function getAllJsonFiles(dir, files = [], counter = { count: 0 }) {
    fs.readdirSync(dir).forEach(file => {
        const filePath = `${dir}/${file}`;
        if (fs.statSync(filePath).isDirectory()) {
            // Pass `files` to the recursive call explicitly
            getAllJsonFiles(filePath, files, counter);
        } else {         
            if (filePath.includes(".json")) {
                //console.log("Pushing " + filePath);
                files.push(filePath);
                fileList.push(filePath);
            }
        }
        counter.count++;
    });
}

function pickFile(files) {
    const file = files[Math.random() * files.length | 0];
    //console.log("Picked " + file);
    pickedFiles.push(file);
}

function pickLocation(files) {
    const selectedLocations = [];

    files.forEach(file => {
        if (selectedLocations.length >= 5) return; // Stop if we already have 5 locations

        const data = fs.readFileSync(file, 'utf8');
        let fixedData = data.trim().replace(/,\s*([\]}])/g, '$1'); // Remove trailing commas

        let locationsArray;
        try {
            locationsArray = JSON.parse(fixedData);
        } catch (error) {
            console.error(`Error parsing JSON from file ${file}:`, error.message);
            return;
        }

        if (locationsArray.length > 0) {
            // Pick one random location from the file
            const randomIndex = Math.floor(Math.random() * locationsArray.length);
            const selectedLocation = locationsArray[randomIndex];
            selectedLocations.push(selectedLocation);
        } else {
            console.warn(`No locations found in file ${file}`);
        }
    });

    // Save and log the selected locations
    saveSet(JSON.stringify(selectedLocations));
    console.log("Picked locations: ", selectedLocations);
}

function generateDailySet() {
    // Clear previous entries
    fileList.length = 0;
    pickedFiles.length = 0;
    pickedLocations.length = 0;

    // Log generation start time
    const now = new Date();
    console.log(`Starting daily set generation at ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} EDT`);

    // Reload JSON files
    getAllJsonFiles('./resources');
    
    // Pick files (up to 5 unique files)
    while (pickedFiles.length < 5 && fileList.length > 0) {
        pickFile(fileList);
    }

    console.log("Picked Files: " + pickedFiles);
    pickLocation(pickedFiles);
}

function saveSet(content) {
    const now = new Date();
    
    // Convert to EDT (UTC-4)
    const utcOffset = -4 * 60; // EDT is UTC-4 hours
    const edtDate = new Date(now.getTime() + (utcOffset * 60 * 1000));

    // Format the date to a more readable format
    const formattedDate = edtDate.toISOString().replace('T', ' ').substring(0, 19) + ' EDT';

    fs.writeFileSync('./output/lastsaved.txt', formattedDate, err => {
        if (err) {
            console.error(err);
            return;
        } else {
            console.log("Last saved timestamp recorded in lastsaved.txt");
        }
    });

    fs.writeFileSync('./output/dailyset.json', content, err => {
        if (err) {
            console.error(err);
            return;
        } else {
            console.log(`Daily set saved to dailyset.json at ${formattedDate}`);
        }
    });
}

function checkCurrentSet() {
    const now = new Date();

    // Calculate 1 AM EDT today (which is 5 AM UTC)
    const today1AM = new Date(now);
    today1AM.setUTCHours(5, 0, 0, 0); // 1 AM EDT corresponds to 5 AM UTC

    // Get the last saved date from file
    const lastSavedDate = new Date(fs.readFileSync('./output/lastsaved.txt', 'utf8'));

    console.log("Last saved date: " + lastSavedDate.toISOString());
    console.log("Today 1 AM EDT: " + today1AM.toISOString());

    // Check if the lastSavedDate is before 1 AM EDT today
    if (lastSavedDate < today1AM) {
        console.log("The current set should be refreshed.");
        generateDailySet();
        return true;
    } else {
        console.log("The current set is still valid.");
        return false;
    }
}

// Create an HTTPS server
const httpsServer = https.createServer(sslOptions, app);

// Start the HTTPS server
httpsServer.listen(port, () => {
    checkCurrentSet();
    console.log('TurboGuessrServer V ' + version + ' listening on https://localhost:' + port);
});

// Schedule daily set at 1am EDT every day (is EDT best?)
cron.schedule('0 1 * * *', () => {
    generateDailySet();
}, {
    timezone: "America/New_York"
});