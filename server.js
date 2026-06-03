import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { propagateKnockout } from './utils/bracket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data', 'matches.json');
const SEED_FILE = path.join(__dirname, 'data', 'matches.json'); // Keep original file for resets

// Helper to read local matches file
async function readLocalMatches() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading local matches:', error);
    return { matches: [] };
  }
}

// Helper to read matches (hybrid Local + Vercel KV)
async function readMatches() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const url = `${process.env.KV_REST_API_URL}/get/matches`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        }
      });
      const data = await response.json();
      if (data.result) {
        return JSON.parse(data.result);
      } else {
        // Seed KV database if empty
        const seedData = await readLocalMatches();
        await writeMatches(seedData);
        return seedData;
      }
    } catch (err) {
      console.error('Error reading from Vercel KV, falling back to local file:', err);
    }
  }
  return readLocalMatches();
}

// Helper to write matches (hybrid Local + Vercel KV)
async function writeMatches(data) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const url = `${process.env.KV_REST_API_URL}/set/matches`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`
        },
        body: JSON.stringify(data)
      });
      return;
    } catch (err) {
      console.error('Error writing to Vercel KV:', err);
    }
  }

  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing local matches:', error);
  }
}

// Fold line helper for ICS files (limit lines to 75 chars according to RFC 5545)
function foldLine(line) {
  if (line.length <= 75) return line;
  let parts = [];
  parts.push(line.substring(0, 75));
  let rest = line.substring(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.substring(0, 74));
    rest = rest.substring(74);
  }
  if (rest.length > 0) {
    parts.push(' ' + rest);
  }
  return parts.join('\r\n');
}

// Helper to format ISO date to ICS format (YYYYMMDDTHHMMSSZ)
function formatToICSDate(isoString) {
  const date = new Date(isoString);
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// Helper to escape text for ICS
function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// Translate/Get Stage Name
function getStageName(stage, lang) {
  const stages = {
    group: { en: 'Group Stage', ar: 'دور المجموعات' },
    r32: { en: 'Round of 32', ar: 'دور الـ 32' },
    r16: { en: 'Round of 16', ar: 'دور الـ 16' },
    qf: { en: 'Quarterfinal', ar: 'ربع النهائي' },
    sf: { en: 'Semifinal', ar: 'نصف النهائي' },
    third: { en: 'Third Place Match', ar: 'مباراة المركز الثالث' },
    final: { en: 'Final', ar: 'النهائي' }
  };
  const val = stages[stage] || { en: stage, ar: stage };
  if (lang === 'en') return val.en;
  if (lang === 'ar') return val.ar;
  return `${val.en} / ${val.ar}`;
}

// Generate ICS File
function generateICS(matches, lang = 'both') {
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorldCup2026//CalendarSubscription//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:FIFA World Cup 2026 / كأس العالم ٢٠٢٦',
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M', // Suggests clients to check feed every 15 minutes
    'X-PUBLISHED-TTL:PT15M'
  ];

  matches.forEach(match => {
    const isPlaceholder1 = !match.team1.code;
    const isPlaceholder2 = !match.team2.code;

    // Names in English
    const team1En = isPlaceholder1 ? match.team1.placeholder_en : `${match.team1.flag || ''} ${match.team1.name_en}`;
    const team2En = isPlaceholder2 ? match.team2.placeholder_en : `${match.team2.name_en} ${match.team2.flag || ''}`;

    // Names in Arabic
    const team1Ar = isPlaceholder1 ? match.team1.placeholder_ar : `${match.team1.flag || ''} ${match.team1.name_ar}`;
    const team2Ar = isPlaceholder2 ? match.team2.placeholder_ar : `${match.team2.name_ar} ${match.team2.flag || ''}`;

    const rawTeam1En = isPlaceholder1 ? match.team1.placeholder_en : match.team1.name_en;
    const rawTeam2En = isPlaceholder2 ? match.team2.placeholder_en : match.team2.name_en;
    const rawTeam1Ar = isPlaceholder1 ? match.team1.placeholder_ar : match.team1.name_ar;
    const rawTeam2Ar = isPlaceholder2 ? match.team2.placeholder_ar : match.team2.name_ar;

    // Title construction based on status and language
    let summary = '';
    const scoreText = `${match.score1} - ${match.score2}`;

    if (lang === 'en') {
      if (match.status === 'live') {
        summary = `⚽ [LIVE: ${scoreText}] ${rawTeam1En} vs ${rawTeam2En}`;
      } else if (match.status === 'halftime') {
        summary = `⏱️ [HT: ${scoreText}] ${rawTeam1En} vs ${rawTeam2En}`;
      } else if (match.status === 'completed') {
        summary = `🏁 [FT: ${scoreText}] ${rawTeam1En} vs ${rawTeam2En}`;
      } else {
        summary = `🏆 ${rawTeam1En} vs ${rawTeam2En}`;
      }
    } else if (lang === 'ar') {
      if (match.status === 'live') {
        summary = `⚽ [مباشر: ${scoreText}] ${rawTeam1Ar} ضد ${rawTeam2Ar}`;
      } else if (match.status === 'halftime') {
        summary = `⏱️ [شوط أول: ${scoreText}] ${rawTeam1Ar} ضد ${rawTeam2Ar}`;
      } else if (match.status === 'completed') {
        summary = `🏁 [النهائية: ${scoreText}] ${rawTeam1Ar} ضد ${rawTeam2Ar}`;
      } else {
        summary = `🏆 ${rawTeam1Ar} ضد ${rawTeam2Ar}`;
      }
    } else {
      // Bilingual (both)
      const code1 = isPlaceholder1 ? '' : ` (${match.team1.code})`;
      const code2 = isPlaceholder2 ? '' : ` (${match.team2.code})`;
      if (match.status === 'live') {
        summary = `⚽ [LIVE: ${scoreText}] ${match.team1.flag || ''}${code1} vs ${match.team2.flag || ''}${code2} | ${rawTeam1Ar} ${scoreText} ${rawTeam2Ar}`;
      } else if (match.status === 'halftime') {
        summary = `⏱️ [HT: ${scoreText}] ${match.team1.flag || ''}${code1} vs ${match.team2.flag || ''}${code2} | الشوط الأول ${rawTeam1Ar} ${scoreText} ${rawTeam2Ar}`;
      } else if (match.status === 'completed') {
        summary = `🏁 [FT: ${scoreText}] ${match.team1.flag || ''}${code1} vs ${match.team2.flag || ''}${code2} | النهائية ${rawTeam1Ar} ${scoreText} ${rawTeam2Ar}`;
      } else {
        summary = `🏆 ${match.team1.flag || ''}${code1} vs ${match.team2.flag || ''}${code2} | ${rawTeam1Ar} ضد ${rawTeam2Ar}`;
      }
    }

    // Date formatting (assuming 2 hours match duration)
    const startDate = new Date(match.date);
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // 2 hours later

    // Location construction
    let location = '';
    if (lang === 'en') {
      location = `${match.stadium.name_en}, ${match.stadium.city_en}`;
    } else if (lang === 'ar') {
      location = `${match.stadium.name_ar}، ${match.stadium.city_ar}`;
    } else {
      location = `${match.stadium.name_en} | ${match.stadium.name_ar} (${match.stadium.city_en} / ${match.stadium.city_ar})`;
    }

    // Description construction
    const stageName = getStageName(match.stage, lang);
    let descriptionParts = [];

    if (lang === 'en' || lang === 'both') {
      descriptionParts.push(`--- ENGLISH DETAILS ---`);
      descriptionParts.push(`Stage: ${stageName}`);
      if (match.group) descriptionParts.push(`Group: Group ${match.group}`);
      descriptionParts.push(`Match: ${team1En} vs ${team2En}`);
      descriptionParts.push(`Stadium: ${match.stadium.name_en} (${match.stadium.city_en})`);
      descriptionParts.push(`Status: ${match.status.toUpperCase()}`);
      if (match.status !== 'scheduled') {
        descriptionParts.push(`Score: ${match.score1} - ${match.score2}`);
        if (match.status === 'halftime') descriptionParts.push(`Halftime Score: ${match.halftime_score}`);
      }
      if (match.goals && match.goals.length > 0) {
        descriptionParts.push('Goals:');
        match.goals.forEach(g => {
          descriptionParts.push(`  ⚽ ${g.player} (${g.minute}') - ${g.team_code}`);
        });
      }
      descriptionParts.push('');
    }

    if (lang === 'ar' || lang === 'both') {
      descriptionParts.push(`--- تفاصيل المباراة بالعربية ---`);
      descriptionParts.push(`المرحلة: ${getStageName(match.stage, 'ar')}`);
      if (match.group) descriptionParts.push(`المجموعة: المجموعة ${match.group}`);
      descriptionParts.push(`المباراة: ${team1Ar} ضد ${team2Ar}`);
      descriptionParts.push(`الملعب: ${match.stadium.name_ar} (${match.stadium.city_ar})`);
      const statusMap = { scheduled: 'جدولة', live: 'مباشر الآن', halftime: 'بين الشوطين', completed: 'انتهت المباراة' };
      descriptionParts.push(`الحالة: ${statusMap[match.status] || match.status}`);
      if (match.status !== 'scheduled') {
        descriptionParts.push(`النتيجة: ${match.score1} - ${match.score2}`);
        if (match.status === 'halftime') descriptionParts.push(`نتيجة الشوط الأول: ${match.halftime_score}`);
      }
      if (match.goals && match.goals.length > 0) {
        descriptionParts.push('الأهداف:');
        match.goals.forEach(g => {
          // Find Arabic team name if possible
          const isT1 = match.team1.code === g.team_code;
          const teamNameAr = isT1 ? match.team1.name_ar : match.team2.name_ar;
          descriptionParts.push(`  ⚽ ${g.player_ar || g.player} (${g.minute}') - ${teamNameAr || g.team_code}`);
        });
      }
      descriptionParts.push('');
    }

    descriptionParts.push(`Live Simulator: http://localhost:${PORT}`);

    const description = descriptionParts.join('\n');

    ics.push('BEGIN:VEVENT');
    ics.push(`UID:match_${match.id}_2026@worldcup2026.com`);
    ics.push(`DTSTAMP:${formatToICSDate(new Date().toISOString())}`);
    ics.push(`DTSTART:${formatToICSDate(startDate.toISOString())}`);
    ics.push(`DTEND:${formatToICSDate(endDate.toISOString())}`);
    ics.push(foldLine(`SUMMARY:${escapeICS(summary)}`));
    ics.push(foldLine(`DESCRIPTION:${escapeICS(description)}`));
    ics.push(foldLine(`LOCATION:${escapeICS(location)}`));
    ics.push(`GEO:${match.stadium.lat};${match.stadium.lon}`);
    ics.push('SEQUENCE:' + (match.goals.length + (match.status === 'completed' ? 2 : match.status === 'live' ? 1 : 0)));
    ics.push('STATUS:CONFIRMED');

    // VALARM 1: Match Kickoff
    ics.push('BEGIN:VALARM');
    ics.push('TRIGGER;RELATED=START:PT0M');
    ics.push('ACTION:DISPLAY');
    if (lang === 'en') {
      ics.push(foldLine(`DESCRIPTION:⚽ World Cup Match Kickoff: ${rawTeam1En} vs ${rawTeam2En}!`));
    } else if (lang === 'ar') {
      ics.push(foldLine(`DESCRIPTION:⚽ انطلاق مباراة كأس العالم: ${rawTeam1Ar} ضد ${rawTeam2Ar}!`));
    } else {
      ics.push(foldLine(`DESCRIPTION:⚽ World Cup Match Kickoff: ${rawTeam1En} vs ${rawTeam2En} / انطلاق المباراة!`));
    }
    ics.push('END:VALARM');

    // VALARM 2: Halftime Score Alert (45 minutes after start)
    ics.push('BEGIN:VALARM');
    ics.push('TRIGGER;RELATED=START:PT45M');
    ics.push('ACTION:DISPLAY');
    if (lang === 'en') {
      ics.push(foldLine(`DESCRIPTION:⏱️ Halftime Alert: ${rawTeam1En} vs ${rawTeam2En}. Check score in calendar!`));
    } else if (lang === 'ar') {
      ics.push(foldLine(`DESCRIPTION:⏱️ تنبيه الشوط الأول: ${rawTeam1Ar} ضد ${rawTeam2Ar}. تحقق من النتيجة في التقويم!`));
    } else {
      ics.push(foldLine(`DESCRIPTION:⏱️ Halftime Alert: ${rawTeam1En} vs ${rawTeam2En} / تنبيه نهاية الشوط الأول!`));
    }
    ics.push('END:VALARM');

    // VALARM 3: Fulltime Score Alert (105 minutes after start)
    ics.push('BEGIN:VALARM');
    ics.push('TRIGGER;RELATED=START:PT1H45M');
    ics.push('ACTION:DISPLAY');
    if (lang === 'en') {
      ics.push(foldLine(`DESCRIPTION:🏁 Fulltime Alert: ${rawTeam1En} vs ${rawTeam2En}. Final score available in calendar!`));
    } else if (lang === 'ar') {
      ics.push(foldLine(`DESCRIPTION:🏁 نهاية المباراة: ${rawTeam1Ar} ضد ${rawTeam2Ar}. النتيجة النهائية متوفرة بالتقويم!`));
    } else {
      ics.push(foldLine(`DESCRIPTION:🏁 Fulltime Alert: ${rawTeam1En} vs ${rawTeam2En} / نهاية المباراة!`));
    }
    ics.push('END:VALARM');

    ics.push('END:VEVENT');
  });

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

// 1. ICS Calendar Endpoint
app.get('/api/worldcup2026.ics', async (req, res) => {
  const lang = req.query.lang || 'both'; // en, ar, both
  const data = await readMatches();
  const icsContent = generateICS(data.matches, lang);
  
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="worldcup2026.ics"');
  res.send(icsContent);
});

// 2. Get Matches API
app.get('/api/matches', async (req, res) => {
  const data = await readMatches();
  res.json(data);
});

// 3. Update Match Event (Score / Status)
app.post('/api/matches/:id/update', async (req, res) => {
  const matchId = parseInt(req.params.id);
  const { status, score1, score2, goals, halftime_score } = req.body;
  const db = await readMatches();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  // Update properties if provided
  if (status !== undefined) match.status = status;
  if (score1 !== undefined) match.score1 = score1;
  if (score2 !== undefined) match.score2 = score2;
  if (goals !== undefined) match.goals = goals;
  if (halftime_score !== undefined) match.halftime_score = halftime_score;

  // Handle halftime auto-saving
  if (status === 'halftime' && !match.halftime_score) {
    match.halftime_score = `${match.score1} - ${match.score2}`;
  }

  // Handle completed & bracket propagation
  if (status === 'completed') {
    let winner, loser;
    if (match.score1 > match.score2) {
      winner = match.team1;
      loser = match.team2;
    } else if (match.score2 > match.score1) {
      winner = match.team2;
      loser = match.team1;
    } else {
      // In knockout stages, handle pen shootout or sudden death placeholder
      // For simulator, default to team1 or we can pass who won shootout
      const shootoutWinner = req.body.shootoutWinner; // 'team1' or 'team2'
      if (shootoutWinner === 'team2') {
        winner = match.team2;
        loser = match.team1;
      } else {
        winner = match.team1;
        loser = match.team2;
      }
    }

    db.matches = propagateKnockout(matchId, winner, loser, db.matches);
  }

  await writeMatches(db);
  res.json({ success: true, match });
});

// 4. Manually override/qualify a team to a knockout slot
app.post('/api/matches/:id/qualify', async (req, res) => {
  const matchId = parseInt(req.params.id);
  const { slot, team } = req.body; // slot: 'team1' or 'team2', team: { name_en, name_ar, code, flag }
  const db = await readMatches();
  const match = db.matches.find(m => m.id === matchId);

  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  match[slot] = team;
  await writeMatches(db);
  res.json({ success: true, match });
});

// 5. Reset All Matches
app.post('/api/matches/reset', async (req, res) => {
  const seedData = {
    "matches": [
      {
        "id": 1,
        "stage": "group",
        "group": "A",
        "team1": { "name_en": "Mexico", "name_ar": "المكسيك", "code": "MEX", "flag": "🇲🇽" },
        "team2": { "name_en": "Canada", "name_ar": "كندا", "code": "CAN", "flag": "🇨🇦" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-11T19:00:00Z",
        "stadium": {
          "name_en": "Estadio Azteca",
          "name_ar": "ملعب أزتيكا",
          "city_en": "Mexico City",
          "city_ar": "مكسيكو سيتي",
          "lat": 19.3029,
          "lon": -99.1505
        },
        "goals": []
      },
      {
        "id": 2,
        "stage": "group",
        "group": "B",
        "team1": { "name_en": "USA", "name_ar": "الولايات المتحدة", "code": "USA", "flag": "🇺🇸" },
        "team2": { "name_en": "Morocco", "name_ar": "المغرب", "code": "MAR", "flag": "🇲🇦" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-12T20:00:00Z",
        "stadium": {
          "name_en": "SoFi Stadium",
          "name_ar": "ملعب سوفي",
          "city_en": "Los Angeles",
          "city_ar": "لوس أنجلوس",
          "lat": 33.9535,
          "lon": -118.3390
        },
        "goals": []
      },
      {
        "id": 3,
        "stage": "group",
        "group": "C",
        "team1": { "name_en": "Saudi Arabia", "name_ar": "السعودية", "code": "KSA", "flag": "🇸🇦" },
        "team2": { "name_en": "Argentina", "name_ar": "الأرجنتين", "code": "ARG", "flag": "🇦🇷" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-13T18:00:00Z",
        "stadium": {
          "name_en": "MetLife Stadium",
          "name_ar": "ملعب ميتلايف",
          "city_en": "New York/New Jersey",
          "city_ar": "نيويورك/نيوجيرسي",
          "lat": 40.8136,
          "lon": -74.0744
        },
        "goals": []
      },
      {
        "id": 4,
        "stage": "group",
        "group": "D",
        "team1": { "name_en": "France", "name_ar": "فرنسا", "code": "FRA", "flag": "🇫🇷" },
        "team2": { "name_en": "Brazil", "name_ar": "البرازيل", "code": "BRA", "flag": "🇧🇷" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-14T17:00:00Z",
        "stadium": {
          "name_en": "Mercedes-Benz Stadium",
          "name_ar": "ملعب مرسيدس بنز",
          "city_en": "Atlanta",
          "city_ar": "أتلانتا",
          "lat": 33.7576,
          "lon": -84.4010
        },
        "goals": []
      },
      {
        "id": 5,
        "stage": "group",
        "group": "E",
        "team1": { "name_en": "Spain", "name_ar": "إسبانيا", "code": "ESP", "flag": "🇪🇸" },
        "team2": { "name_en": "Germany", "name_ar": "ألمانيا", "code": "GER", "flag": "🇩🇪" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-15T21:00:00Z",
        "stadium": {
          "name_en": "Hard Rock Stadium",
          "name_ar": "ملعب هارد روك",
          "city_en": "Miami",
          "city_ar": "ميامي",
          "lat": 25.9580,
          "lon": -80.2389
        },
        "goals": []
      },
      {
        "id": 6,
        "stage": "group",
        "group": "F",
        "team1": { "name_en": "England", "name_ar": "إنجلترا", "code": "ENG", "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
        "team2": { "name_en": "Italy", "name_ar": "إيطاليا", "code": "ITA", "flag": "🇮🇹" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-16T19:00:00Z",
        "stadium": {
          "name_en": "BC Place",
          "name_ar": "بي سي بليس",
          "city_en": "Vancouver",
          "city_ar": "فانكوفر",
          "lat": 49.2768,
          "lon": -123.1120
        },
        "goals": []
      },
      {
        "id": 81,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group A", "placeholder_ar": "متصدر المجموعة أ" },
        "team2": { "placeholder_en": "Runner-up Group B", "placeholder_ar": "وصيف المجموعة ب" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-28T18:00:00Z",
        "stadium": {
          "name_en": "MetLife Stadium",
          "name_ar": "ملعب ميتلايف",
          "city_en": "New York/New Jersey",
          "city_ar": "نيويورك/نيوجيرسي",
          "lat": 40.8136,
          "lon": -74.0744
        },
        "goals": []
      },
      {
        "id": 82,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group C", "placeholder_ar": "متصدر المجموعة ج" },
        "team2": { "placeholder_en": "Runner-up Group D", "placeholder_ar": "وصيف المجموعة د" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-28T21:00:00Z",
        "stadium": {
          "name_en": "SoFi Stadium",
          "name_ar": "ملعب سوفي",
          "city_en": "Los Angeles",
          "city_ar": "لوس أنجلوس",
          "lat": 33.9535,
          "lon": -118.3390
        },
        "goals": []
      },
      {
        "id": 83,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group E", "placeholder_ar": "متصدر المجموعة هـ" },
        "team2": { "placeholder_en": "Runner-up Group F", "placeholder_ar": "وصيف المجموعة و" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-29T18:00:00Z",
        "stadium": {
          "name_en": "Mercedes-Benz Stadium",
          "name_ar": "ملعب مرسيدس بنز",
          "city_en": "Atlanta",
          "city_ar": "أتلانتا",
          "lat": 33.7576,
          "lon": -84.4010
        },
        "goals": []
      },
      {
        "id": 84,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group G", "placeholder_ar": "متصدر المجموعة ز" },
        "team2": { "placeholder_en": "Runner-up Group H", "placeholder_ar": "وصيف المجموعة ح" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-29T21:00:00Z",
        "stadium": {
          "name_en": "Hard Rock Stadium",
          "name_ar": "ملعب هارد روك",
          "city_en": "Miami",
          "city_ar": "ميامي",
          "lat": 25.9580,
          "lon": -80.2389
        },
        "goals": []
      },
      {
        "id": 85,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group I", "placeholder_ar": "متصدر المجموعة ط" },
        "team2": { "placeholder_en": "Runner-up Group J", "placeholder_ar": "وصيف المجموعة ي" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-30T18:00:00Z",
        "stadium": {
          "name_en": "AT&T Stadium",
          "name_ar": "ملعب إيه تي آند تي",
          "city_en": "Dallas",
          "city_ar": "دالاس",
          "lat": 32.7473,
          "lon": -97.0928
        },
        "goals": []
      },
      {
        "id": 86,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group K", "placeholder_ar": "متصدر المجموعة ك" },
        "team2": { "placeholder_en": "Runner-up Group L", "placeholder_ar": "وصيف المجموعة ل" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-06-30T21:00:00Z",
        "stadium": {
          "name_en": "Estadio Akron",
          "name_ar": "ملعب أكرون",
          "city_en": "Guadalajara",
          "city_ar": "غوادالاخارا",
          "lat": 20.6811,
          "lon": -103.4627
        },
        "goals": []
      },
      {
        "id": 87,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group A2", "placeholder_ar": "متصدر المجموعة أ2" },
        "team2": { "placeholder_en": "Runner-up Group B2", "placeholder_ar": "وصيف المجموعة ب2" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-01T18:00:00Z",
        "stadium": {
          "name_en": "BC Place",
          "name_ar": "بي سي بليس",
          "city_en": "Vancouver",
          "city_ar": "فانكوفر",
          "lat": 49.2768,
          "lon": -123.1120
        },
        "goals": []
      },
      {
        "id": 88,
        "stage": "r16",
        "team1": { "placeholder_en": "Winner Group C2", "placeholder_ar": "متصدر المجموعة ج2" },
        "team2": { "placeholder_en": "Runner-up Group D2", "placeholder_ar": "وصيف المجموعة د2" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-01T21:00:00Z",
        "stadium": {
          "name_en": "Estadio Azteca",
          "name_ar": "ملعب أزتيكا",
          "city_en": "Mexico City",
          "city_ar": "مكسيكو سيتي",
          "lat": 19.3029,
          "lon": -99.1505
        },
        "goals": []
      },
      {
        "id": 89,
        "stage": "qf",
        "team1": { "placeholder_en": "Winner Match 81", "placeholder_ar": "فائز مباراة 81" },
        "team2": { "placeholder_en": "Winner Match 82", "placeholder_ar": "فائز مباراة 82" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-04T18:00:00Z",
        "stadium": {
          "name_en": "MetLife Stadium",
          "name_ar": "ملعب ميتلايف",
          "city_en": "New York/New Jersey",
          "city_ar": "نيويورك/نيوجيرسي",
          "lat": 40.8136,
          "lon": -74.0744
        },
        "goals": []
      },
      {
        "id": 90,
        "stage": "qf",
        "team1": { "placeholder_en": "Winner Match 83", "placeholder_ar": "فائز مباراة 83" },
        "team2": { "placeholder_en": "Winner Match 84", "placeholder_ar": "فائز مباراة 84" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-04T21:00:00Z",
        "stadium": {
          "name_en": "SoFi Stadium",
          "name_ar": "ملعب سوفي",
          "city_en": "Los Angeles",
          "city_ar": "لوس أنجلوس",
          "lat": 33.9535,
          "lon": -118.3390
        },
        "goals": []
      },
      {
        "id": 91,
        "stage": "qf",
        "team1": { "placeholder_en": "Winner Match 85", "placeholder_ar": "فائز مباراة 85" },
        "team2": { "placeholder_en": "Winner Match 86", "placeholder_ar": "فائز مباراة 86" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-05T18:00:00Z",
        "stadium": {
          "name_en": "AT&T Stadium",
          "name_ar": "ملعب إيه تي آند تي",
          "city_en": "Dallas",
          "city_ar": "دالاس",
          "lat": 32.7473,
          "lon": -97.0928
        },
        "goals": []
      },
      {
        "id": 92,
        "stage": "qf",
        "team1": { "placeholder_en": "Winner Match 87", "placeholder_ar": "فائز مباراة 87" },
        "team2": { "placeholder_en": "Winner Match 88", "placeholder_ar": "فائز مباراة 88" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-05T21:00:00Z",
        "stadium": {
          "name_en": "Hard Rock Stadium",
          "name_ar": "ملعب هارد روك",
          "city_en": "Miami",
          "city_ar": "ميامي",
          "lat": 25.9580,
          "lon": -80.2389
        },
        "goals": []
      },
      {
        "id": 93,
        "stage": "sf",
        "team1": { "placeholder_en": "Winner Match 89", "placeholder_ar": "فائز مباراة 89" },
        "team2": { "placeholder_en": "Winner Match 90", "placeholder_ar": "فائز مباراة 90" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-08T19:00:00Z",
        "stadium": {
          "name_en": "Mercedes-Benz Stadium",
          "name_ar": "ملعب مرسيدس بنز",
          "city_en": "Atlanta",
          "city_ar": "أتلانتا",
          "lat": 33.7576,
          "lon": -84.4010
        },
        "goals": []
      },
      {
        "id": 94,
        "stage": "sf",
        "team1": { "placeholder_en": "Winner Match 91", "placeholder_ar": "فائز مباراة 91" },
        "team2": { "placeholder_en": "Winner Match 92", "placeholder_ar": "فائز مباراة 92" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-09T19:00:00Z",
        "stadium": {
          "name_en": "AT&T Stadium",
          "name_ar": "ملعب إيه تي آند تي",
          "city_en": "Dallas",
          "city_ar": "دالاس",
          "lat": 32.7473,
          "lon": -97.0928
        },
        "goals": []
      },
      {
        "id": 103,
        "stage": "third",
        "team1": { "placeholder_en": "Loser Match 93", "placeholder_ar": "خاسر مباراة 93" },
        "team2": { "placeholder_en": "Loser Match 94", "placeholder_ar": "خاسر مباراة 94" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-18T18:00:00Z",
        "stadium": {
          "name_en": "Hard Rock Stadium",
          "name_ar": "ملعب هارد روك",
          "city_en": "Miami",
          "city_ar": "ميامي",
          "lat": 25.9580,
          "lon": -80.2389
        },
        "goals": []
      },
      {
        "id": 104,
        "stage": "final",
        "team1": { "placeholder_en": "Winner Match 93", "placeholder_ar": "فائز مباراة 93" },
        "team2": { "placeholder_en": "Winner Match 94", "placeholder_ar": "فائز مباراة 94" },
        "score1": 0,
        "score2": 0,
        "status": "scheduled",
        "halftime_score": "",
        "date": "2026-07-19T19:00:00Z",
        "stadium": {
          "name_en": "MetLife Stadium",
          "name_ar": "ملعب ميتلايف",
          "city_en": "New York/New Jersey",
          "city_ar": "نيويورك/نيوجيرسي",
          "lat": 40.8136,
          "lon": -74.0744
        },
        "goals": []
      }
    ]
  };
  await writeMatches(seedData);
  res.json({ success: true, message: 'All matches have been reset' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
