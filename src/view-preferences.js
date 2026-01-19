/**
 * Simple script to view all user preferences
 * Usage: node src/view-preferences.js
 */

import { getAllPreferences, getStats } from './preferences.js';

const prefs = getAllPreferences();
const stats = getStats();

console.log('\n📊 Preference Statistics:');
console.log(`   Total users with preferences: ${stats.total}`);
console.log(`   Opted in: ${stats.optedIn}`);
console.log(`   Opted out: ${stats.optedOut}`);
console.log(`   Default behavior: ${stats.defaultOptIn ? 'Opt-in by default' : 'Opt-out by default'}`);

if (prefs.length === 0) {
  console.log('\n✅ No explicit preferences set - all users are using the default (opted in)');
} else {
  const optedIn = prefs.filter(p => p.optedIn);
  const optedOut = prefs.filter(p => !p.optedIn);

  if (optedIn.length > 0) {
    console.log('\n✅ Opted In:');
    optedIn.forEach(p => {
      const date = new Date(p.updatedAt).toLocaleString();
      console.log(`   • ${p.email} (updated: ${date})`);
    });
  }

  if (optedOut.length > 0) {
    console.log('\n🔕 Opted Out:');
    optedOut.forEach(p => {
      const date = new Date(p.updatedAt).toLocaleString();
      console.log(`   • ${p.email} (updated: ${date})`);
    });
  }
}

console.log('\n');
