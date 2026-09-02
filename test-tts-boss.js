const { EdgeTTS } = require('edge-tts-universal');
const fs = require('fs');

async function main() {
  const ttsInstance = new EdgeTTS("Boss! DVSC ready hai. Aaj kya karna hai, batao!", "hi-IN-MadhurNeural");
  const result = await ttsInstance.synthesize();
  const arrayBuffer = await result.audio.arrayBuffer();
  fs.writeFileSync('test_boss.mp3', Buffer.from(arrayBuffer));
  console.log('Saved test_boss.mp3');
}
main();
