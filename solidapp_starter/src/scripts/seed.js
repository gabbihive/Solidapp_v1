import { run } from '../db.js';
run(`INSERT OR IGNORE INTO settings(key,value) VALUES ('site_name','Solidapp'),('site_tagline','Mutual aid, offers, and questions — no login.')`);
run(`INSERT OR IGNORE INTO sections(slug,name,description) VALUES ('help','Help requests','Ask for collective help'),('offers','Offers','Offer services or items for free'),('questions','Questions','Ask anything')`);
console.log('Seed complete.');
