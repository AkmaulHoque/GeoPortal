import fs from 'fs';
import path from 'path';
const war = path.resolve('resources/geoportal.war');
if (!fs.existsSync(war)) throw new Error(`Missing ${war}`);
const size = fs.statSync(war).size;
if (size < 100000) throw new Error(`WAR looks too small (${size} bytes)`);
console.log(`OK: ${war} (${(size/1024).toFixed(1)} KiB)`);
