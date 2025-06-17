const rentalSchema = new mongoose.Schema({
    // ... existing code ...
    interval: {
        type: String,
        enum: ['half-day', 'full-day'],
        required: true
    },
    timeBlock: {
        type: String,
        enum: ['AM', 'PM'],
        required: function() {
            return this.interval === 'half-day';
        }
    },
    // ... existing code ...
}); 