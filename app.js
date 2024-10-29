const express = require('express');
const fs = require('fs');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const port = 3000;
const version = '1.0.0';

const fileList = [];
const pickedFiles = [];
const pickedLocations = [];

//SERVER

// maximum of 30 requests per minute
const dailySetLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,  // 1 minute
    max: 30,                  // Limit in time window
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

function generateDailySet() {
    getAllJsonFiles('./resources');
    for (let i = 0; i < 5; i++) {
        pickFile(fileList);
    }
    console.log("Picked Files: " + pickedFiles);

    pickLocation(pickedFiles);
}

function pickLocation(files) {
    const selectedLocations = [];

    files.forEach(file => {
        const data = fs.readFileSync(file, 'utf8');

        // Preprocess the data to handle invalid JSON structures
        let fixedData = data.trim();

        const regex = /,\s*([\]}])/g; // Matches a comma followed by whitespace and a closing bracket
        fixedData = fixedData.replace(regex, '$1'); // Remove trailing commas

        let locationsArray;
        try {
            locationsArray = JSON.parse(fixedData);
        } catch (error) {
            console.error(`Error parsing JSON from file ${file}:`, error.message);
            return; // Skip this file if there's a parsing error
        }

        if (locationsArray.length > 0) {
            const randomIndex = Math.floor(Math.random() * locationsArray.length);
            const selectedLocation = locationsArray[randomIndex];
            selectedLocations.push(selectedLocation);
        } else {
            console.warn(`No locations found in file ${file}`);
        }
    });
    pickedLocations.push(selectedLocations);
    saveSet(JSON.stringify(selectedLocations));
    console.log("Picked locations: ", selectedLocations);
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
            console.log("Last saved file saved to lastsaved.txt");
        }
    });

    fs.writeFileSync('./output/dailyset.json', content, err => {
        if (err) {
            console.error(err);
            return;
        } else {
            console.log("Daily set saved to dailyset.json");
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
        return true;
    } else {
        console.log("The current set is still valid.");
        generateDailySet();
        return false;
    }
}

app.listen(port, () => {
    checkCurrentSet();
    console.log('TurboGuessrServer V ' + version + ' listening on http://localhost:' + port);
});

// Schedule daily set at 1am EDT every day (is EDT best?)
cron.schedule('0 1 * * *', () => {
    generateDailySet();
}, {
    timezone: "America/New_York"
});