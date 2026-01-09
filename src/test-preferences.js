/**
 * Script to check user preferences
 * Usage: node src/test-preferences.js [email]
 */

import 'dotenv/config';
import { isOptedIn, getAllPreferences, getStats } from './preferences.js';

const email = process.argv[2];

if (email) {
  // Check specific user
  const optedIn = isOptedIn(email);
  console.log(`\n📧 ${email}`);
  console.log(`   Status: ${optedIn ? '✅ Opted IN' : '🔕 Opted OUT'}`);
  
  const allPrefs = getAllPreferences();
  const userPref = allPrefs.find(p => p.email.toLowerCase() === email.toLowerCase());
  
  if (userPref) {
    console.log(`   Updated: ${new Date(userPref.updatedAt).toISOString()}`);
  } else {
    console.log(`   Note: Using default (${process.env.DEFAULT_OPT_IN !== 'false' ? 'opted in' : 'opted out'})`);
  }
} else {
  // Show all preferences
  const stats = getStats();
  const allPrefs = getAllPreferences();
  
  console.log('\n📊 Preference Statistics:');
  console.log(`   Total users with explicit preferences: ${stats.total}`);
  console.log(`   ✅ Opted IN: ${stats.optedIn}`);
  console.log(`   🔕 Opted OUT: ${stats.optedOut}`);
  console.log(`   Default behavior: ${stats.defaultOptIn ? 'Opted IN by default' : 'Opted OUT by default'}`);
  
  if (allPrefs.length > 0) {
    console.log('\n📋 All Preferences:');
    allPrefs.forEach(pref => {
      const status = pref.optedIn ? '✅ IN' : '🔕 OUT';
      const updated = new Date(pref.updatedAt).toISOString();
      console.log(`   ${status}  ${pref.email.padEnd(40)}  Updated: ${updated}`);
    });
    
    console.log('\n✅ Opted IN Users:');
    allPrefs.filter(p => p.optedIn).forEach(pref => {
      console.log(`   ${pref.email}`);
    });
    
    console.log('\n🔕 Opted OUT Users:');
    allPrefs.filter(p => !p.optedIn).forEach(pref => {
      console.log(`   ${pref.email}`);
    });
  } else {
    console.log('\n   No explicit preferences set. All users use default behavior.');
  }
}

console.log('\n');
