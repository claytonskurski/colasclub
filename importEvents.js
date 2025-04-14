const mongoose = require('mongoose');
const Event = require('./models/events'); // Ensure the path to the events model is correct
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public_html', 'calendardirectory', 'SCO.json'); // Updated to the new structure

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/mydatabase', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB');

  // Read the JSON file
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading file:', err);
      return mongoose.disconnect();
    }

    try {
      const events = JSON.parse(data);
      Event.insertMany(events)
        .then(() => {
          console.log('Events imported successfully');
          mongoose.disconnect();
        })
        .catch((error) => {
          console.error('Error importing events:', error);
          mongoose.disconnect();
        });
    } catch (error) {
      console.error('Error parsing JSON:', error);
      mongoose.disconnect();
    }
  });
}).catch((error) => {
  console.error('Error connecting to MongoDB:', error);
});
