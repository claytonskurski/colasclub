import json
from icalendar import Calendar
import uuid
import os
import html
import requests
import sys
import re
from datetime import datetime

# Unsplash API Access Key (replace with your own)
UNSPLASH_ACCESS_KEY = 'your-unsplash-access-key'

# Event type keywords for automatic tagging
EVENT_TYPES = {
    'hiking': ['hike', 'hiking', 'trail', 'mountain', 'trek'],
    'biking': ['bike', 'biking', 'cycling', 'bicycle', 'mountain biking'],
    'kayaking': ['kayak', 'kayaking', 'paddle', 'river', 'lake'],
    'running': ['run', 'running', 'jog', 'jogging', 'trail run'],
    'camping': ['camp', 'camping', 'backpacking', 'overnight'],
    'climbing': ['climb', 'climbing', 'boulder', 'bouldering', 'rock climbing'],
    'general': ['meetup', 'social', 'gathering', 'meeting']
}

def fetch_image_url(query):
    """Fetch a single image URL from Unsplash based on the query."""
    try:
        url = 'https://api.unsplash.com/search/photos'
        params = {
            'query': f"{query} outdoor activity",
            'per_page': 1,
            'client_id': UNSPLASH_ACCESS_KEY,
            'orientation': 'landscape'
        }
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        if data['results']:
            return data['results'][0]['urls']['regular']
        return None
    except Exception as e:
        print(f"Error fetching image for query '{query}': {e}")
        return None

def extract_tags_from_text(text):
    """Extract relevant tags from event text."""
    text = text.lower()
    tags = set()
    
    # Check for event type keywords
    for event_type, keywords in EVENT_TYPES.items():
        if any(keyword in text for keyword in keywords):
            tags.add(event_type)
    
    # Extract hashtags if present
    hashtags = re.findall(r'#(\w+)', text)
    tags.update(hashtags)
    
    # Add difficulty level if found
    if 'beginner' in text or 'easy' in text:
        tags.add('beginner-friendly')
    elif 'intermediate' in text:
        tags.add('intermediate')
    elif 'advanced' in text or 'difficult' in text:
        tags.add('advanced')
    
    # Add time-based tags
    if 'morning' in text or 'am' in text:
        tags.add('morning')
    elif 'evening' in text or 'pm' in text:
        tags.add('evening')
    
    return list(tags)

def format_description(raw_description):
    """Format the description with proper HTML and extract structured data."""
    # Remove email signatures and unnecessary formatting
    description = html.unescape(raw_description)
    
    # Split into sections if they exist
    sections = {
        'description': '',
        'requirements': '',
        'meeting_point': '',
        'what_to_bring': ''
    }
    
    # Try to identify sections using common markers
    lines = description.split('\n')
    current_section = 'description'
    
    for line in lines:
        line = line.strip()
        lower_line = line.lower()
        
        if not line:
            continue
        
        if 'what to bring' in lower_line or 'bring:' in lower_line:
            current_section = 'what_to_bring'
            continue
        elif 'requirements' in lower_line or 'required:' in lower_line:
            current_section = 'requirements'
            continue
        elif 'meeting' in lower_line and ('point' in lower_line or 'location' in lower_line):
            current_section = 'meeting_point'
            continue
        
        sections[current_section] += line + '\n'
    
    # Format as HTML
    html_description = f"""
        <div class="event-description">
            {sections['description'].strip()}
        </div>
    """
    
    if sections['requirements'].strip():
        html_description += f"""
            <div class="event-requirements">
                <h4>Requirements</h4>
                <p>{sections['requirements'].strip()}</p>
            </div>
        """
    
    if sections['what_to_bring'].strip():
        html_description += f"""
            <div class="event-what-to-bring">
                <h4>What to Bring</h4>
                <p>{sections['what_to_bring'].strip()}</p>
            </div>
        """
    
    if sections['meeting_point'].strip():
        html_description += f"""
            <div class="event-meeting-point">
                <h4>Meeting Point</h4>
                <p>{sections['meeting_point'].strip()}</p>
            </div>
        """
    
    return html_description

def ics_to_json(ics_file_path, json_file_path):
    print(f"Reading ICS file from: {ics_file_path}")
    with open(ics_file_path, 'r') as ics_file:
        ics_content = ics_file.read()

    calendar = Calendar.from_ical(ics_content)
    events = []

    for component in calendar.walk():
        if component.name == "VEVENT":
            summary = str(component.get('summary', ''))
            raw_description = str(component.get('description', ''))
            
            # Format description and extract structured data
            formatted_description = format_description(raw_description)
            
            # Extract tags from both summary and description
            tags = extract_tags_from_text(f"{summary} {raw_description}")
            
            # Fetch image based on event type and summary
            image_query = f"{' '.join(tags[:1])} {summary}"
            image_url = fetch_image_url(image_query)
            
            # Convert datetime to proper format
            dtstart = component.get('dtstart').dt
            dtend = component.get('dtend').dt
            
            if isinstance(dtstart, datetime):
                dtstart = dtstart.isoformat()
            if isinstance(dtend, datetime):
                dtend = dtend.isoformat()

            event = {
                "eventId": str(uuid.uuid4()),
                "summary": summary,
                "description": formatted_description,
                "dtstart": dtstart,
                "dtend": dtend,
                "location": str(component.get('location', '')),
                "image": image_url if image_url else "",
                "tags": tags,
                "status": "approved",  # Default status for calendar events
                "attendees": [],
                "rsvps": [],
                "createdAt": datetime.now().isoformat()
            }
            events.append(event)
            print(f"Processed event: {event['summary']} with tags: {event['tags']}")

    with open(json_file_path, 'w') as json_file:
        json.dump(events, json_file, indent=4)
    print(f"JSON file written to: {json_file_path}")

if __name__ == "__main__":
    # Check for command-line arguments
    if len(sys.argv) != 3:
        print("Usage: python convert_ics_to_json.py <ics_file_path> <json_file_path>")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        ics_file_path = os.path.join(script_dir, 'SCO.ics')
        json_file_path = os.path.join(script_dir, 'SCO.json')
    else:
        ics_file_path = sys.argv[1]
        json_file_path = sys.argv[2]

    ics_to_json(ics_file_path, json_file_path)