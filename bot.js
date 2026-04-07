const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');
const Tesseract = require('tesseract.js');

const TOKEN = process.env.TOKEN;     // 봇 토큰
const CLIENT_ID = "1490651449074515968";  // Application ID
const GUILD_ID = "1074232108261834822";   // 서버 ID

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function normalizeText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/／/g, '/')
    .replace(/㎞/g, 'km')
    .replace(/ｈ/gi, 'h')
    .replace(/kcaI/gi, 'kcal')
    .replace(/kaal/gi, 'kcal')
    .replace(/kmh/gi, 'km/h');
}

function getLineAfter(lines, keyword) {
  const idx = lines.findIndex(line => line.includes(keyword));
  if (idx !== -1 && idx + 1 < lines.length) {
    return lines[idx + 1];
  }
  return '';
}

// 갤럭시(삼성헬스)
function parseGalaxy(text) {
  let detailSection = text;

  const detailStart = text.indexOf('운동 상세정보');
  if (detailStart !== -1) {
    detailSection = text.slice(detailStart);
  }

  const cutKeywords = ['차트', '메모'];
  for (const word of cutKeywords) {
    const idx = detailSection.indexOf(word);
    if (idx !== -1) {
      detailSection = detailSection.slice(0, idx);
      break;
    }
  }

  const lines = detailSection
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const timeSpeedLine =
    getLineAfter(lines, '운동 시간 평균 속도') ||
    getLineAfter(lines, '운동시간 평균속도') ||
    getLineAfter(lines, '운동 시간') ||
    '';

  const calorieStepsLine =
    getLineAfter(lines, '운동 칼로리 걸음') ||
    getLineAfter(lines, '운동칼로리 걸음') ||
    getLineAfter(lines, '칼로리 걸음') ||
    '';

  const paceTotalLine =
    getLineAfter(lines, '평균 페이스 총 시간') ||
    getLineAfter(lines, '평균페이스 총시간') ||
    getLineAfter(lines, '평균 페이스') ||
    '';

  const exerciseTime =
    timeSpeedLine.match(/\b([0-9]{1,2}:\d{2})\b/)?.[1] || null;

  const speed =
    timeSpeedLine.match(/([0-9]+(?:\.[0-9]+)?\s*km\/h)/i)?.[1] || null;

  const numberMatches = calorieStepsLine.match(/\b\d+\b/g) || [];
  let calories = null;
  let steps = null;

  if (numberMatches.length >= 2) {
    const raw = numberMatches[0];
    const last = numberMatches[1];
    steps = last;

    if (raw.length >= 3) {
      calories = raw[0] + 'kcal';
    } else {
      calories = raw + 'kcal';
    }
  }

  const pace =
    paceTotalLine.match(/([0-9]{1,2}[':][0-9]{2}"?\s*\/\s*km)/i)?.[1]?.replace(/\s+/g, '') ||
    text.match(/([0-9]{1,2}[':][0-9]{2}"?\s*\/\s*km)/i)?.[1]?.replace(/\s+/g, '') ||
    null;

  const totalTime =
    paceTotalLine.match(/\b([0-9]{1,2}:\d{2})\b/)?.[1] || null;

  return {
    device: '갤럭시',
    distance: null,
    exerciseTime,
    pace,
    speed,
    calories,
    steps,
    totalTime
  };
}

// 아이폰(네가 올린 화면 기준)
function parseIPhone(text) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  let distance = null;
  let pace = null;
  let exerciseTime = null;
  let calories = null;

  const statLine = lines.find(line =>
    /[0-9]+[.:][0-9]+\s+[0-9]{1,2}'[0-9]{2}"?\s+[0-9]{1,2}:\d{2}/.test(line)
  );

  if (statLine) {
    const statMatch = statLine.match(
      /([0-9]+[.:][0-9]+)\s+([0-9]{1,2}'[0-9]{2}"?)\s+([0-9]{1,2}:\d{2})/
    );

    if (statMatch) {
      distance = statMatch[1].replace(':', '.') + 'km';
      pace = statMatch[2] + '/km';
      exerciseTime = statMatch[3];
    }
  }

  const calorieLine = lines.find(line =>
    /^[0-9]+\s+[0-9]+/.test(line)
  );

  if (calorieLine) {
    const calorieMatch = calorieLine.match(/^([0-9]+)/);
    if (calorieMatch) {
      calories = calorieMatch[1] + 'kcal';
    }
  }

  return {
    device: '아이폰',
    distance,
    exerciseTime,
    pace,
    speed: null,
    calories,
    steps: null,
    totalTime: null
  };
}

function detectDevice(text) {
  const hasGalaxyKeywords =
    text.includes('운동 상세정보') ||
    text.includes('운동 칼로리') ||
    text.includes('총 시간');

  const hasIPhoneKeywords =
    text.includes('킬로미터') ||
    text.includes('칼로리') ||
    text.includes('시간') ||
    /pace|calories|time|distance/i.test(text);

  if (hasGalaxyKeywords) return 'galaxy';
  if (hasIPhoneKeywords) return 'iphone';
  return 'unknown';
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('설명')
      .setDescription('운동봇 사용법을 확인합니다.'),

    new SlashCommandBuilder()
      .setName('운동')
      .setDescription('운동 스크린샷을 분석합니다.')
      .addAttachmentOption(option =>
        option
          .setName('사진')
          .setDescription('삼성헬스 / 애플 피트니스 스크린샷')
          .setRequired(true)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log('슬래시 명령어 등록 완료');
}

client.once('ready', async () => {
  console.log(`로그인 성공: ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error('명령어 등록 실패:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === '설명') {
    await interaction.reply({
      content:
`🏃 운동봇 사용법

/운동 실행 후 사진 업로드

지원:
- 삼성헬스
- 애플 피트니스 / 건강 앱`,

      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === '운동') {
    const attachment = interaction.options.getAttachment('사진');

    if (!attachment) {
      await interaction.reply({
        content: '📷 사진을 첨부해주세요!',
        ephemeral: true
      });
      return;
    }
     await interaction.deferReply({ ephemeral: true
        });

    try {
      const imageUrl = attachment.proxyURL || attachment.url;
      const result = await Tesseract.recognize(imageUrl, 'kor+eng');
      const text = normalizeText(result.data.text);

      console.log("===== OCR 원문 시작 =====");
      console.log(text);
      console.log("===== OCR 원문 끝 =====");

      const detected = detectDevice(text);

      let parsed;
      if (detected === 'galaxy') {
        parsed = parseGalaxy(text);
      } else if (detected === 'iphone') {
        parsed = parseIPhone(text);
      } else {
        const galaxyResult = parseGalaxy(text);
        const filledCount = [
          galaxyResult.exerciseTime,
          galaxyResult.pace,
          galaxyResult.speed,
          galaxyResult.calories,
          galaxyResult.steps,
          galaxyResult.totalTime
        ].filter(Boolean).length;

        parsed = filledCount >= 3 ? galaxyResult : parseIPhone(text);
      }

      const displayName =
        interaction.member?.displayName || interaction.user.username;

      if (parsed.device === '아이폰') {
        await interaction.channel.send(
`📋 ${displayName}님의 운동 기록

📱 감지기기: ${parsed.device}
📏 거리: ${parsed.distance || '인식 실패'}
🏃 평균페이스: ${parsed.pace || '인식 실패'}
⏱ 시간: ${parsed.exerciseTime || '인식 실패'}
🔥 칼로리: ${parsed.calories || '인식 실패'}`
        );
      } else {
        await interaction.channel.send(
`📋 ${displayName}님의 운동 기록

📱 감지기기: ${parsed.device}
⏱ 운동시간: ${parsed.exerciseTime || '인식 실패'}
🏃 평균페이스: ${parsed.pace || '인식 실패'}
⚡ 평균속도: ${parsed.speed || '-'}
🔥 운동칼로리: ${parsed.calories || '인식 실패'}
👣 걸음: ${parsed.steps || '-'}
🕒 총시간: ${parsed.totalTime || '인식 실패'}`
        );
      }

      await interaction.followUp({
        content: '✅ 운동 기록 등록 완료',
        ephemeral: true
      });

    } catch (error) {
      console.error(error);

      await interaction.followUp({
        content: '❌ 이미지 분석 실패',
        ephemeral: true
      });
    }
  }
});

client.login(TOKEN);