const apiKey = 'YOUR_API_KEY_HERE';
fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
  .then(res => res.json())
  .then(data => {
    if (data.models) {
      console.log('Available models for generateContent:');
      data.models.filter(m => m.supportedGenerationMethods.includes('generateContent')).forEach(m => {
        console.log(m.name);
      });
    } else {
      console.log('Error:', data);
    }
  })
  .catch(err => console.error(err));
