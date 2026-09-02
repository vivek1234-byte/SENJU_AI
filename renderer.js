// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DVSC Frontend Renderer Logic
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

document.addEventListener('DOMContentLoaded', () => {
  // Check if dvsc API is available
  if (!window.dvsc) {
    console.error('DVSC API is not exposed. Check preload.js.');
    return;
  }

  // State
  let settings = { apiKey: '', userName: 'Vivek', voiceEnabled: true, language: 'hi-en' };

  // DOM Elements
  const bootOverlay = document.getElementById('boot-overlay');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');
  
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Boot Sequence (prefetches greeting + audio during animation)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  
  // Cache for preloaded greeting
  let preloadedGreeting = null;
  let preloadedAudioData = null;

  function startBootSequence() {
    const lines = document.querySelectorAll('.boot-line');
    let maxDelay = 0;
    
    lines.forEach(line => {
      const delay = parseInt(line.getAttribute('data-delay'));
      if (delay > maxDelay) maxDelay = delay;
      setTimeout(() => {
        line.classList.add('visible');
      }, delay);
    });

    // Start prefetching greeting + audio in parallel with animation
    prefetchGreeting();

    setTimeout(() => {
      bootOverlay.style.opacity = '0';
      setTimeout(() => {
        bootOverlay.style.display = 'none';
        initializeApp();
      }, 500);
    }, maxDelay + 1000);
  }

  /**
   * Prefetch the startup greeting and generate TTS audio
   * while the boot animation is still playing.
   */
  async function prefetchGreeting() {
    try {
      settings = await window.dvsc.getSettings();
      if (!settings.apiKey) return;

      // Step 1: Get greeting text from Gemini (during boot animation)
      const res = await window.dvsc.getStartupGreeting();
      if (res.success && res.greeting) {
        preloadedGreeting = res.greeting;
        
        // Step 2: Pre-generate TTS audio (also during boot animation)
        if (settings.voiceEnabled) {
          const ttsResult = await window.dvsc.speak(res.greeting);
          if (ttsResult.success && ttsResult.audioData) {
            preloadedAudioData = ttsResult.audioData;
          }
        }
      }
    } catch (err) {
      console.log('Prefetch greeting failed (will fallback):', err);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // App Initialization
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function initializeApp() {
    // Load Settings (might already be loaded by prefetch)
    if (!settings.apiKey) {
      settings = await window.dvsc.getSettings();
    }
    populateSettingsForm();

    // Check API Key
    if (!settings.apiKey) {
      const noKeyMsg = "Vivek, I'm online, but I need an API key to function properly. Please add your Groq API key in Settings.";
      addMessage(noKeyMsg, 'assistant');
      speak(noKeyMsg);
    } else if (preloadedGreeting) {
      // Use prefetched greeting â€” instant, no delay!
      addMessage(preloadedGreeting, 'assistant');
      
      // Play preloaded audio instantly (Web Audio API)
      if (preloadedAudioData && settings.voiceEnabled) {
        playAudioBase64(preloadedAudioData);
      }
    } else {
      // Fallback: fetch greeting now if prefetch didn't complete in time
      const res = await window.dvsc.getStartupGreeting();
      if (res.success) {
        addMessage(res.greeting, 'assistant');
        speak(res.greeting);
      }
    }

    // Load Data
    loadChatsList();
    loadReminders();
    loadTimetable();
    
    if (settings.locationEnabled) {
      requestPreciseLocation();
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Location
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function requestPreciseLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const coords = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        };
        await window.dvsc.updatePreciseLocation(coords);
      }, (error) => {
        console.warn('Geolocation error:', error);
      });
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Window Controls
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  document.getElementById('btn-minimize').addEventListener('click', () => window.dvsc.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.dvsc.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.dvsc.close());

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Navigation
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const dataView = item.getAttribute('data-view');
      if (!dataView) return; // Skip buttons without data-view (e.g. New Chat)

      // Update nav active state
      navItems.forEach(n => {
        if (n.hasAttribute('data-view')) n.classList.remove('active');
      });
      item.classList.add('active');

      // Update view active state
      const viewId = 'view-' + dataView;
      views.forEach(v => {
        if (v.id === viewId) v.classList.add('active');
        else v.classList.remove('active');
      });
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Multi-Chat & AI Logic
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  
  const recentChatsList = document.getElementById('recent-chats-list');
  const btnNewChat = document.getElementById('btn-new-chat');
  let activeChatId = null;

  async function loadChatsList() {
    const chats = await window.dvsc.getAllChats();
    recentChatsList.innerHTML = '';
    
    chats.forEach(chat => {
      const btn = document.createElement('button');
      btn.className = 'recent-chat-item' + (activeChatId === chat.id ? ' active' : '');
      btn.innerHTML = `
        <span class="chat-title">${escapeHTML(chat.title)}</span>
        <div class="delete-chat-btn" title="Delete Chat" data-id="${chat.id}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </div>
      `;
      
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.delete-chat-btn')) return; // handled separately
        switchChat(chat.id);
      });
      
      const delBtn = btn.querySelector('.delete-chat-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await window.dvsc.deleteChat(chat.id);
        if (res.success) {
          activeChatId = res.currentChatId;
          loadChatsList();
          if (res.newHistory) {
            renderChatHistory(res.newHistory);
          }
        }
      });
      
      recentChatsList.appendChild(btn);
    });

    if (chats.length > 0 && !activeChatId) {
      // Setup initial view
      activeChatId = chats[0].id;
      // We don't call switchChat here because history is already loaded on init
    }
  }

  async function switchChat(chatId) {
    if (activeChatId === chatId) return;
    const chat = await window.dvsc.loadChat(chatId);
    if (chat) {
      activeChatId = chat.id;
      renderChatHistory(chat.history);
      loadChatsList(); // Re-render list to update active class
    }
  }

  btnNewChat.addEventListener('click', async () => {
    const newChat = await window.dvsc.createNewChat();
    activeChatId = newChat.id;
    chatMessages.innerHTML = '';
    loadChatsList();
    
    // Simulate startup greeting for new chat
    addMessage("Boss! SENJU online hai. Naya chat shuru kar rahe hain? ðŸŒ¸", 'assistant');
  });

  function stripStructuredTags(text) {
    let clean = text;
    clean = clean.replace(/\[REMINDER\][\s\S]*?\[\/REMINDER\]/g, '');
    clean = clean.replace(/\[TIMETABLE\][\s\S]*?\[\/TIMETABLE\]/g, '');
    clean = clean.replace(/\[COMMAND\][\s\S]*?\[\/COMMAND\]/g, '');
    return clean.trim();
  }

  function renderChatHistory(history) {
    chatMessages.innerHTML = '';
    history.forEach(msg => {
      // Handle the parts array structure
      const text = msg.parts ? msg.parts[0].text : msg.text;
      if (text) {
        const displayRole = msg.role === 'model' ? 'assistant' : msg.role;
        const cleanText = displayRole === 'assistant' ? stripStructuredTags(text) : text;
        if (cleanText) {
          addMessage(cleanText, displayRole);
        }
      }
    });
  }
  
  function formatMarkdown(text) {
    let html = escapeHTML(text);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
  }

  function addMessage(content, role) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    let html = `<div class="message-container">`;
    if (role === 'assistant') {
      html += `<div class="assistant-avatar">&#127800;</div>`;
    }
    html += `<div class="message-bubble ${role}">${formatMarkdown(content)}</div>`;
    html += `</div><div class="message-time">${time}</div>`;
    
    msgDiv.innerHTML = html;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'message assistant typing-msg';
    div.innerHTML = `
      <div class="message-container">
        <div class="assistant-avatar">&#127800;</div>
        <div class="typing-indicator"><span></span><span></span><span></span></div>
      </div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function hideTyping() {
    const typingMsg = document.querySelector('.typing-msg');
    if (typingMsg) typingMsg.remove();
  }

  async function handleSend() {
    const text = chatInput.value.trim();
    if (!text) return;

    if (settings.provider !== 'ollama' && !settings.apiKey) {
      window.dvsc.notify("Error", "Please enter API Key in settings first.");
      return;
    }

    chatInput.value = '';
    addMessage(text, 'user');
    showTyping();

    const result = await window.dvsc.sendMessage(text);
    hideTyping();
    loadChatsList(); // Reload chats list if the title might have updated

    if (result.success) {
      let responseText = result.response;
      
      // Parse structured tags
      responseText = await parseStructuredTags(responseText);

      addMessage(responseText, 'assistant');
      speak(responseText);
    } else {
      addMessage(`Error: ${result.error}`, 'assistant');
    }
  }

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Speech Recognition (Voice Input via Groq Whisper API)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const voiceBtn = document.getElementById('voice-btn');
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];

  async function startRecording() {
    if (!settings.apiKey) {
      window.dvsc.notify("Error", "Please enter your Groq API Key in settings first.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the microphone
        stream.getTracks().forEach(track => track.stop());
        
        chatInput.placeholder = 'Transcribing...';
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        
        try {
          const formData = new FormData();
          formData.append('file', new File([audioBlob], 'audio.webm', { type: 'audio/webm' }));
          // whisper-large-v3-turbo + language=hi prevents ALL language hallucinations (Spanish/Vietnamese etc)
          formData.append('model', 'whisper-large-v3-turbo');
          formData.append('language', 'hi');
          formData.append('prompt', 'Vivek, Google Chrome kholo. gana chalao. volume badhao. main baitha tha. theek hai yaar.');

          const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.apiKey}` },
            body: formData
          });

          if (!response.ok) throw new Error(await response.text());

          const data = await response.json();
          let rawText = (data.text || '').trim();
          if (!rawText) { chatInput.placeholder = 'Type a message, Vivek...'; return; }

          // Step 2: If Devanagari detected, convert to Roman Hinglish via LLM
          const hasDevanagari = /[\u0900-\u097F]/.test(rawText);
          if (hasDevanagari) {
            chatInput.placeholder = 'Converting to Hinglish...';
            const llmRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [{
                  role: 'user',
                  content: `Convert this Hindi/Devanagari text to Roman script Hinglish ONLY. Do not translate to English. Keep the same words, just change script. Output ONLY the Roman Hinglish text, nothing else.\n\nInput: ${rawText}`
                }],
                temperature: 0,
                max_tokens: 200
              })
            });
            if (llmRes.ok) {
              const llmData = await llmRes.json();
              rawText = (llmData.choices[0].message.content || rawText).trim();
            }
          }

          chatInput.value = rawText;
          handleSend();
        } catch (error) {
          console.error('Transcription error:', error);
          window.dvsc.notify("Error", 'Transcription failed: ' + error.message);
          chatInput.placeholder = 'Type a message, Vivek...';
        }
      };

      mediaRecorder.start();
      isRecording = true;
      voiceBtn.classList.add('listening');
      chatInput.placeholder = 'Listening...';
    } catch (error) {
      console.error('Microphone access denied:', error);
      window.dvsc.notify("Error", 'Could not access microphone. Please check your system settings.');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
    voiceBtn.classList.remove('listening');
  }

  voiceBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Listen for background Wake Word detection from main.js (Picovoice legacy)
  if (window.dvsc.onWakeWordDetected) {
    window.dvsc.onWakeWordDetected(() => {
      console.log('Wake word triggered UI!');
      if (!isRecording) {
        startRecording();
      }
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Background Wake Word Engine (Groq VAD)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let backgroundAudioContext = null;
  let backgroundStream = null;
  let backgroundMediaRecorder = null;
  let bgAudioChunks = [];
  let isBackgroundListening = false;
  let volumeInterval = null;
  
  // Start background listening when window is hidden
  if (window.dvsc.onWindowHidden) {
    window.dvsc.onWindowHidden(() => {
      console.log('[DVSC] Entering Background Wake Word Mode...');
      startBackgroundListening();
    });
  }

  // Stop background listening when window is shown
  if (window.dvsc.onWindowShown) {
    window.dvsc.onWindowShown(() => {
      console.log('[DVSC] Exiting Background Mode...');
      stopBackgroundListening();
    });
  }

  async function startBackgroundListening() {
    if (!settings.apiKey || isBackgroundListening) return;
    
    try {
      backgroundStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      backgroundAudioContext = new AudioContext();
      if (backgroundAudioContext.state === 'suspended') {
        await backgroundAudioContext.resume();
      }
      const source = backgroundAudioContext.createMediaStreamSource(backgroundStream);
      const analyser = backgroundAudioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let isSpeaking = false;
      let silenceStart = 0;
      const SILENCE_THRESHOLD = 15; // Volume threshold (0-255)
      const SILENCE_DURATION = 1500; // ms of silence to mark end of speech

      isBackgroundListening = true;

      volumeInterval = setInterval(() => {
        if (!isBackgroundListening) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        let avgVolume = sum / bufferLength;

        if (avgVolume > SILENCE_THRESHOLD) {
          // Noise detected
          if (!isSpeaking) {
            isSpeaking = true;
            startBackgroundRecording();
          }
          silenceStart = 0;
        } else {
          // Silence detected
          if (isSpeaking) {
            if (silenceStart === 0) silenceStart = Date.now();
            if (Date.now() - silenceStart > SILENCE_DURATION) {
              isSpeaking = false;
              stopBackgroundRecordingAndProcess();
            }
          }
        }
      }, 100);
      
    } catch (e) {
      console.error('Failed to start background listening:', e);
    }
  }

  function stopBackgroundListening() {
    isBackgroundListening = false;
    if (volumeInterval) clearInterval(volumeInterval);
    if (backgroundMediaRecorder && backgroundMediaRecorder.state !== 'inactive') {
      backgroundMediaRecorder.stop();
    }
    if (backgroundAudioContext) backgroundAudioContext.close();
    if (backgroundStream) backgroundStream.getTracks().forEach(t => t.stop());
    
    backgroundAudioContext = null;
    backgroundStream = null;
    backgroundMediaRecorder = null;
  }

  function startBackgroundRecording() {
    if (!backgroundStream) return;
    bgAudioChunks = [];
    backgroundMediaRecorder = new MediaRecorder(backgroundStream);
    backgroundMediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) bgAudioChunks.push(e.data);
    };
    backgroundMediaRecorder.start();
    console.log('[DVSC Background] Speech detected. Recording...');
  }

  function stopBackgroundRecordingAndProcess() {
    if (!backgroundMediaRecorder || backgroundMediaRecorder.state === 'inactive') return;
    
    backgroundMediaRecorder.onstop = async () => {
      const audioBlob = new Blob(bgAudioChunks, { type: 'audio/webm' });
      console.log('[DVSC Background] Speech ended. Sending to Groq to check Wake Word...');
      
      try {
        const formData = new FormData();
        formData.append('file', new File([audioBlob], 'audio.webm', { type: 'audio/webm' }));
        formData.append('model', 'whisper-large-v3-turbo');
        // No language param = auto-detect. Roman Hinglish prompt forces Roman script output.
        formData.append('prompt', 'utho senju, jarvis, kaam karte hain, wake up, Chrome kholo, gana chalao, haan theek hai yaar.');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${settings.apiKey}` },
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          const text = (data.text || '').toLowerCase();
          console.log('[DVSC Background] Heard:', text);
          
          if (
            text.includes('utho') || text.includes('à¤‰à¤ à¥‹') || 
            text.includes('dvsc') || text.includes('à¤¡à¥€à¤µà¥€à¤à¤¸à¤¸à¥€') || text.includes('d.v.s.c') ||
            text.includes('jarvis') || text.includes('à¤œà¤¾à¤°à¥à¤µà¤¿à¤¸') ||
            text.includes('kaam karte hain') || text.includes('à¤•à¤¾à¤® à¤•à¤°à¤¤à¥‡ à¤¹à¥ˆà¤‚') ||
            text.includes('wake up') || text.includes('get up')
          ) {
            console.log('[DVSC Background] Wake word matched! Waking up...');
            window.dvsc.show(); // Popup the window
            // Optionally, pre-fill the chat input or start recording immediately:
            setTimeout(() => {
              if (!isRecording) startRecording();
            }, 500);
          }
        }
      } catch (e) {
        console.error('Background transcription error:', e);
      }
    };
    backgroundMediaRecorder.stop();
  }

  // Parse [REMINDER] and [TIMETABLE] tags from response
  async function parseStructuredTags(text) {
    let cleanText = text;

    // Parse [REMINDER]...[/REMINDER]
    const reminderRegex = /\[REMINDER\](.*?)\[\/REMINDER\]/gs;
    let reminderMatch;
    while ((reminderMatch = reminderRegex.exec(text)) !== null) {
      try {
        const reminderData = JSON.parse(reminderMatch[1]);
        await window.dvsc.addReminder(reminderData);
        loadReminders();
      } catch (e) {
        console.error('Failed to parse reminder json', e);
      }
      cleanText = cleanText.replace(reminderMatch[0], ''); // Remove from visible text
    }

    // Parse [TIMETABLE]...[/TIMETABLE]
    const ttRegex = /\[TIMETABLE\](.*?)\[\/TIMETABLE\]/gs;
    let ttMatch;
    while ((ttMatch = ttRegex.exec(text)) !== null) {
      try {
        const ttData = JSON.parse(ttMatch[1]);
        await window.dvsc.addTimetableEntry(ttData);
        loadTimetable();
      } catch (e) {
        console.error('Failed to parse timetable json', e);
      }
      cleanText = cleanText.replace(ttMatch[0], ''); // Remove from visible text
    }

    // Parse [COMMAND]...[/COMMAND]
    const cmdRegex = /\[COMMAND\](.*?)\[\/COMMAND\]/gs;
    let cmdMatch;
    while ((cmdMatch = cmdRegex.exec(text)) !== null) {
      try {
        let jsonStr = cmdMatch[1].trim();
        if (!jsonStr.endsWith('}')) jsonStr += '}'; // Auto-fix missing closing brace
        
        const cmdData = JSON.parse(jsonStr);
        if (cmdData.action === 'whatsapp') {
          if (!navigator.onLine) {
            addMessage(`âš ï¸ Switch to internet to send WhatsApp messages.`, 'assistant');
          } else {
            const res = await window.dvsc.sendWhatsAppMessage(cmdData.target, cmdData.value);
            if (res && !res.success) {
              addMessage(`âš ï¸ WhatsApp error: ${res.error}`, 'assistant');
            }
          }
        } else if (cmdData.action === 'whatsapp_delete') {
          if (!navigator.onLine) {
            addMessage(`âš ï¸ Switch to internet to manage WhatsApp messages.`, 'assistant');
          } else {
            const res = await window.dvsc.deleteWhatsAppMessage();
            if (res && !res.success) {
              addMessage(`âš ï¸ WhatsApp delete error: ${res.error}`, 'assistant');
            }
          }
        } else {
          await window.dvsc.executeCommand(cmdData);
        }
      } catch (e) {
        console.error('Failed to parse command json', e);
        addMessage(`âš ï¸ AI Command Error: Could not execute command.`, 'assistant');
      }
      cleanText = cleanText.replace(cmdMatch[0], ''); // Remove from visible text
    }

    return cleanText.trim();
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Speech â€” Edge Neural TTS (hi-IN-MadhurNeural)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let audioContext = null;
  let currentAudioSource = null;

  async function playAudioBase64(dataUri) {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Stop current audio if playing
      if (currentAudioSource) {
        currentAudioSource.stop();
        currentAudioSource.disconnect();
        currentAudioSource = null;
      }

      // Extract base64 part
      const base64Data = dataUri.split(',')[1];
      const binaryStr = window.atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      
      const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
      currentAudioSource = audioContext.createBufferSource();
      currentAudioSource.buffer = audioBuffer;
      currentAudioSource.connect(audioContext.destination);
      currentAudioSource.onended = () => {
        currentAudioSource = null;
      };
      currentAudioSource.start(0);
    } catch (e) {
      console.error('Web Audio API playback failed:', e);
    }
  }

  async function speak(text) {
    if (!settings.voiceEnabled) return;

    // Stop current audio immediately when new speech is requested
    if (currentAudioSource) {
      currentAudioSource.stop();
      currentAudioSource.disconnect();
      currentAudioSource = null;
    }

    try {
      const result = await window.dvsc.speak(text);
      if (result.success && result.audioData) {
        playAudioBase64(result.audioData);
      }
    } catch (err) {
      console.error('TTS failed:', err);
    }
  }
  window.speak = speak;
  window.stopAudio = () => {
    if (currentAudioSource) {
      try { currentAudioSource.stop(); } catch(e){}
      currentAudioSource.disconnect();
      currentAudioSource = null;
    }
  };

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Reminders Logic
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const remindersList = document.getElementById('reminders-list');
  const addReminderBtn = document.getElementById('add-reminder-btn');
  const reminderForm = document.getElementById('reminder-form');
  const cancelReminderBtn = document.getElementById('cancel-reminder-btn');
    const saveReminderBtn = document.getElementById('save-reminder-btn');
  addReminderBtn.addEventListener('click', () => {
    reminderForm.style.display = 'block';
  });

  cancelReminderBtn.addEventListener('click', () => {
    reminderForm.style.display = 'none';
  });

  saveReminderBtn.addEventListener('click', async () => {
    const title = document.getElementById('reminder-title').value;
    const desc = document.getElementById('reminder-desc').value;
    const dt = document.getElementById('reminder-datetime').value;
    const repeat = document.getElementById('reminder-repeat').value;

    if (!title || !dt) {
      window.dvsc.notify("Error", "Title and Date & Time are required.");
      return;
    }

    await window.dvsc.addReminder({ title, description: desc, datetime: dt, repeat });
    reminderForm.style.display = 'none';
    
    // Clear form
    document.getElementById('reminder-title').value = '';
    document.getElementById('reminder-desc').value = '';
    document.getElementById('reminder-datetime').value = '';
    document.getElementById('reminder-repeat').value = 'none';

    loadReminders();
  });

  async function loadReminders() {
    const reminders = await window.dvsc.getReminders();
    remindersList.innerHTML = '';
    
    // Sort by datetime
    reminders.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    reminders.forEach(r => {
      const dt = new Date(r.datetime);
      const timeStr = dt.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
      
      const el = document.createElement('div');
      el.className = `reminder-item ${r.completed ? 'completed' : ''}`;
      el.innerHTML = `
        <input type="checkbox" class="reminder-checkbox" ${r.completed ? 'checked' : ''} data-id="${r.id}">
        <div class="reminder-content">
          <div class="reminder-title">${escapeHTML(r.title)}</div>
          ${r.description ? `<div class="reminder-desc">${escapeHTML(r.description)}</div>` : ''}
          <div class="reminder-meta">
            <span class="reminder-time">${timeStr}</span>
            ${r.repeat !== 'none' ? `<span class="reminder-repeat">â†» ${r.repeat}</span>` : ''}
          </div>
        </div>
        <div class="reminder-actions">
          <button class="del-reminder-btn" data-id="${r.id}" style="color: #ff4d4d; border: 1px solid #ff4d4d; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: bold; cursor: pointer;">Delete</button>
        </div>
      `;
      remindersList.appendChild(el);
    });

    // Attach listeners
    document.querySelectorAll('.reminder-checkbox').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        await window.dvsc.toggleReminder(id);
        loadReminders();
      });
    });

    document.querySelectorAll('.del-reminder-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const targetBtn = e.target.closest('.del-reminder-btn');
        if (!targetBtn) return;
        const id = targetBtn.getAttribute('data-id');
        await window.dvsc.deleteReminder(id);
        loadReminders();
      });
    });
  }

  // Handle triggered reminders
  window.dvsc.onReminderTriggered((reminder) => {
    const msg = `â° Vivek, reminder alert: **${reminder.title}**\n${reminder.description || ''}`;
    addMessage(msg, 'assistant');
    speak(`Vivek, reminder alert: ${reminder.title}. ${reminder.description || ''}`);
    loadReminders();
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Timetable Logic
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const timetableGrid = document.getElementById('timetable-grid');
  const addTimetableBtn = document.getElementById('add-timetable-btn');
  const timetableForm = document.getElementById('timetable-form');
  const cancelTtBtn = document.getElementById('cancel-tt-btn');
  const saveTtBtn = document.getElementById('save-tt-btn');
  
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  addTimetableBtn.addEventListener('click', () => {
    timetableForm.style.display = 'block';
  });

  cancelTtBtn.addEventListener('click', () => {
    timetableForm.style.display = 'none';
  });

  saveTtBtn.addEventListener('click', async () => {
    const day = document.getElementById('tt-day').value;
    const category = document.getElementById('tt-category').value;
    const start = document.getElementById('tt-start').value;
    const end = document.getElementById('tt-end').value;
    const title = document.getElementById('tt-title').value;

    if (!title || !start || !end) {
      window.dvsc.notify("Error", "Title, Start time, and End time are required.");
      return;
    }

    await window.dvsc.addTimetableEntry({ day, category, startTime: start, endTime: end, title });
    timetableForm.style.display = 'none';
    
    // Clear inputs
    document.getElementById('tt-title').value = '';
    document.getElementById('tt-start').value = '';
    document.getElementById('tt-end').value = '';

    loadTimetable();
  });

  async function loadTimetable() {
    const entries = await window.dvsc.getTimetable();
    timetableGrid.innerHTML = '';
    
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    days.forEach(day => {
      const col = document.createElement('div');
      col.className = `tt-day-col ${day === today ? 'today' : ''}`;
      
      let html = `<div class="tt-day-header">${day}</div><div class="tt-entries">`;
      
      // Filter and sort entries for this day
      const dayEntries = entries.filter(e => e.day === day)
                                .sort((a, b) => a.startTime.localeCompare(b.startTime));
                                
      dayEntries.forEach(e => {
        html += `
          <div class="tt-entry cat-${e.category}">
            <div class="tt-time">${e.startTime} - ${e.endTime}</div>
            <div class="tt-title">${escapeHTML(e.title)}</div>
            <button class="tt-delete" data-id="${e.id}" style="color: #ff4d4d; border: 1px solid #ff4d4d; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: bold; cursor: pointer;">Delete</button>
          </div>
        `;
      });
      
      html += `</div>`;
      col.innerHTML = html;
      timetableGrid.appendChild(col);
    });

    // Delete listeners
    document.querySelectorAll('.tt-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const targetBtn = e.target.closest('.tt-delete');
        if (!targetBtn) return;
        const id = targetBtn.getAttribute('data-id');
        await window.dvsc.deleteTimetableEntry(id);
        loadTimetable();
      });
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Settings Logic
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const settingsGroqBlock = document.getElementById('settings-groq-block');
      
  const settingsApikey = document.getElementById('settings-apikey');
  const toggleApikeyBtn = document.getElementById('toggle-apikey');
  
  const settingsVoice = document.getElementById('settings-voice');
  const settingsLocation = document.getElementById('settings-location');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const restartAppBtn = document.getElementById('restart-app-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');

  function populateSettingsForm() {
                settingsApikey.value = settings.apiKey || '';
    settingsVoice.checked = settings.voiceEnabled;
    settingsLocation.checked = settings.locationEnabled;
  }

  toggleApikeyBtn.addEventListener('click', () => {
    if (settingsApikey.type === 'password') {
      settingsApikey.type = 'text';
      toggleApikeyBtn.textContent = 'Hide';
    } else {
      settingsApikey.type = 'password';
      toggleApikeyBtn.textContent = 'Show';
    }
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const newSettings = {
      ...settings,
            voiceEnabled: settingsVoice.checked,
      locationEnabled: settingsLocation.checked
    };
    
    await window.dvsc.saveSettings(newSettings);
    settings = newSettings;
    
    if (settings.locationEnabled) {
      requestPreciseLocation();
    }
    
    // Add confirmation message in chat
    addMessage("Settings updated successfully.", 'assistant');
    window.dvsc.notify("Settings", "Settings saved successfully!");
  });

  restartAppBtn.addEventListener('click', () => {
    window.dvsc.restartApp();
  });

  clearChatBtn.addEventListener('click', async () => {
    if (confirm("Are you sure you want to clear chat history?")) {
      await window.dvsc.clearChatHistory();
      chatMessages.innerHTML = '';
      addMessage("Chat history cleared. Systems refreshed.", 'assistant');
    }
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // WhatsApp Logic
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const waQrImg = document.getElementById('whatsapp-qr-img');
  const waStatus = document.getElementById('whatsapp-status-text');
  const waLoader = document.getElementById('whatsapp-loader');
  const waActions = document.getElementById('wa-actions');
  const waLogoutBtn = document.getElementById('whatsapp-logout-btn');

  // Check state on load
  async function updateWhatsAppStateUI() {
    if (!navigator.onLine) {
      waLoader.style.display = 'none';
      waQrImg.style.display = 'none';
      waStatus.textContent = 'âš ï¸ Switch to internet to use WhatsApp';
      waStatus.style.color = 'var(--danger, #ff4444)';
      waActions.style.display = 'none';
      return;
    }

    const data = await window.dvsc.getWhatsAppState();
    const state = typeof data === 'string' ? data : data.state;
    const qr = typeof data === 'string' ? null : data.qr;
    
    if (state === 'connected') {
      waLoader.style.display = 'none';
      waQrImg.style.display = 'none';
      waStatus.textContent = 'WhatsApp Linked Successfully! âœ…';
      waStatus.style.color = 'var(--success, #00ff88)';
      waActions.style.display = 'block';
    } else if (state === 'waiting' || state === 'disconnected') {
      if (qr) {
        waLoader.style.display = 'none';
        waQrImg.src = qr;
        waQrImg.style.display = 'inline-block';
        waStatus.textContent = 'Scan QR code to link WhatsApp';
        waStatus.style.color = 'var(--accent-secondary)';
        waActions.style.display = 'none';
      } else {
        waLoader.style.display = 'block';
        waQrImg.style.display = 'none';
        waStatus.textContent = 'Waiting for QR...';
        waStatus.style.color = 'var(--text-muted)';
        waActions.style.display = 'none';
      }
    }
  }

  updateWhatsAppStateUI();
  window.addEventListener('online', updateWhatsAppStateUI);
  window.addEventListener('offline', updateWhatsAppStateUI);

  waLogoutBtn.addEventListener('click', async () => {
    waActions.style.display = 'none';
    waLoader.style.display = 'block';
    waStatus.textContent = 'Logging out...';
    waStatus.style.color = 'var(--text-muted)';
    await window.dvsc.logoutWhatsApp();
  });

  window.dvsc.onWhatsAppQR((qrDataUrl) => {
    waLoader.style.display = 'none';
    waQrImg.src = qrDataUrl;
    waQrImg.style.display = 'inline-block';
    waStatus.textContent = 'Scan QR code to link WhatsApp';
    waStatus.style.color = 'var(--accent-secondary)';
    waActions.style.display = 'none';
  });

  window.dvsc.onWhatsAppReady(() => {
    waLoader.style.display = 'none';
    waQrImg.style.display = 'none';
    waStatus.textContent = 'WhatsApp Linked Successfully! âœ…';
    waStatus.style.color = 'var(--success, #00ff88)';
    waActions.style.display = 'block';
  });

  window.dvsc.onWhatsAppDisconnected(() => {
    waLoader.style.display = 'block';
    waQrImg.style.display = 'none';
    waStatus.textContent = 'WhatsApp disconnected. Waiting to reconnect...';
    waStatus.style.color = 'var(--danger, #ff4444)';
    waActions.style.display = 'none';
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Start Application
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  startBootSequence();

});


// ===============================================================
//  SENJU MODE - Immersive 3D Sphere + Mouse Control + Auto Voice
// ===============================================================

(function initSenjuMode() {

  const jarvisOverlay = document.getElementById('jarvis-overlay');
  const jarvisCloseBtn = document.getElementById('jarvis-close-btn');
  const btnJarvis = document.getElementById('btn-jarvis-mode');
  const bgCanvas = document.getElementById('jarvis-bg-canvas');
  const waveCanvas = document.getElementById('jwave-canvas');
  const jhudTime = document.getElementById('jhud-time');
  const jhudStatusVal = document.getElementById('jhud-status-val');
  const jresponseText = document.getElementById('jresponse-text');
  const jvoiceLabel = document.getElementById('jvoice-label');
  const jvoiceTranscript = document.getElementById('jvoice-transcript');

  if (!jarvisOverlay || !btnJarvis) return;

  // -- State --
  let jarvisActive = false;
  let animFrame = null;

  // Mouse position (normalized 0-1, centered at 0.5)
  let mouseTarget = { x: 0.5, y: 0.5 };
  let mouseCurrent = { x: 0.5, y: 0.5 };
  let mouseDown = false;

  // Sphere rotation
  let sphereRotX = 0, sphereRotY = 0;
  let sphereRotXvel = 0, sphereRotYvel = 0;
  let autoRotY = 0;
  let t = 0;

  // Sphere scale (mouse scroll controlled)
  var sphereScaleTarget = 1.0;
  var sphereScaleCurrent = 1.0;

  // Solar System focus state
  var focusedPlanet = null; // null = solar system overview, object = focused planet
  var showPlanets = true;
  var originalFileLabels = null; // backup of FILE_LABELS for SUN

  // -- Canvas setup --
  const bgCtx = bgCanvas ? bgCanvas.getContext('2d') : null;
  let W = window.innerWidth, H = window.innerHeight;

  function resizeBgCanvas() {
    W = window.innerWidth; H = window.innerHeight;
    bgCanvas.width = W; bgCanvas.height = H;
  }
  window.addEventListener('resize', resizeBgCanvas);

  // -- Mouse events on canvas --
  if (bgCanvas) {
    bgCanvas.addEventListener('mousemove', function(e) {
      if (!jarvisActive) return;
      mouseTarget.x = e.clientX / W;
      mouseTarget.y = e.clientY / H;
    });
    bgCanvas.addEventListener('mousedown', function() { mouseDown = true; });
    bgCanvas.addEventListener('mouseup', function() { mouseDown = false; });
    bgCanvas.addEventListener('mouseleave', function() { mouseDown = false; });
    bgCanvas.addEventListener('wheel', function(e) {
      if (!jarvisActive) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.05 : 0.05;
      sphereScaleTarget += delta;
      if (sphereScaleTarget < 0.4) sphereScaleTarget = 0.4;
      if (sphereScaleTarget > 2.0) sphereScaleTarget = 2.0;
    }, { passive: false });
  }

  // -- 3D Rotation helpers --
  function rotY(x, y, z, a) {
    return { x: x*Math.cos(a) + z*Math.sin(a), y: y, z: -x*Math.sin(a) + z*Math.cos(a) };
  }
  function rotX(x, y, z, a) {
    return { x: x, y: y*Math.cos(a) - z*Math.sin(a), z: y*Math.sin(a) + z*Math.cos(a) };
  }
  function rotZ(x, y, z, a) {
    return { x: x*Math.cos(a) - y*Math.sin(a), y: x*Math.sin(a) + y*Math.cos(a), z: z };
  }

  // -- File/folder labels for nodes --
  var FILE_LABELS = [
    'main.js', 'renderer.js', 'index.html', 'package.json', 'styles/', 'modules/',
    'preload.js', 'gemini.js', 'reminders.js', 'timetable.js', 'node_modules/',
    'main.css', 'jarvis.css', '.env', 'config.json', 'assets/', 'fonts/',
    'app.log', 'build/', 'dist/', 'src/', 'utils.js', 'api.js', 'auth.js',
    'database.db', 'cache/', 'temp/', 'README.md', 'LICENSE', '.gitignore',
    'tsconfig.json', 'webpack.config.js', 'babel.config.js', 'jest.config.js',
    'routes/', 'middleware/', 'controllers/', 'models/', 'views/', 'public/',
    'images/', 'icons/', 'sounds/', 'data.json', 'schema.sql', 'migrate.js',
    'test/', 'spec/', 'hooks/', 'context/', 'store.js', 'actions.js',
    'reducer.js', 'types.ts', 'interface.ts', 'enum.ts', 'constants.js',
    'helpers.js', 'validators.js', 'formatters.js', 'logger.js', 'server.js',
    'client.js', 'socket.js', 'events.js', 'worker.js', 'service.js',
    'handler.js', 'parser.js', 'compiler.js', 'loader.js', 'plugin.js',
    'theme.css', 'layout.css', 'components/', 'pages/', 'lib/', 'vendor/',
    'scripts/', 'docs/', 'examples/', 'templates/', 'i18n/', 'locales/',
    'deploy.sh', 'Dockerfile', 'docker-compose.yml', 'nginx.conf', 'Makefile',
    'Procfile', '.env.local', '.env.prod', 'secrets.json', 'keys/',
    'certificates/', 'backup/', 'logs/', 'analytics.js', 'monitor.js',
    'report.js', 'dashboard.js', 'profile.js', 'settings.js', 'account.js',
    'payment.js', 'checkout.js', 'cart.js', 'product.js', 'search.js',
    'filter.js', 'sort.js', 'pagination.js', 'infinite-scroll.js', 'modal.js',
    'tooltip.js', 'dropdown.js', 'sidebar.js', 'navbar.js', 'footer.js',
    'header.js', 'hero.js', 'card.js', 'list.js', 'table.js', 'form.js',
    'input.js', 'button.js', 'icon.js', 'avatar.js', 'badge.js', 'alert.js',
    'toast.js', 'spinner.js', 'skeleton.js', 'progress.js', 'slider.js',
    'switch.js', 'radio.js', 'checkbox.js', 'select.js', 'textarea.js',
    'upload.js', 'download.js', 'clipboard.js', 'share.js', 'print.js',
    'export.js', 'import.js', 'sync.js', 'offline.js', 'pwa.js',
    'manifest.json', 'sw.js', 'register.js', 'login.js', 'logout.js',
    'forgot.js', 'reset.js', 'verify.js', 'confirm.js', 'welcome.js',
    'onboard.js', 'tutorial.js', 'help.js', 'faq.js', 'contact.js',
    'about.js', 'terms.js', 'privacy.js', 'cookies.js', 'error.js',
    '404.html', '500.html', 'robots.txt', 'sitemap.xml', 'humans.txt',
    'changelog.md', 'contributing.md', 'security.md', 'code_of_conduct.md',
    'pull_request.md', 'issue_template.md', 'bug_report.md', 'feature.md'
  ];

  // -- Generate sphere with Fibonacci distribution --
  var NODE_COUNT = 200;
  function makeSphereNodes(count, radius) {
    var nodes = [];
    for (var i = 0; i < count; i++) {
      var theta = Math.acos(1 - 2 * (i + 0.5) / count);
      var phi = Math.PI * (1 + Math.sqrt(5)) * i;
      nodes.push({
        ox: Math.sin(theta) * Math.cos(phi),
        oy: Math.cos(theta),
        oz: Math.sin(theta) * Math.sin(phi),
        r: radius,
        pulse: Math.random() * Math.PI * 2,
        speed: 0.003 + Math.random() * 0.012,
        label: FILE_LABELS[i % FILE_LABELS.length],
      });
    }
    return nodes;
  }

  var sphereNodes = [];
  var sphereEdges = [];
  var SPHERE_R = 0;

  function buildEdges(nodes, maxDist) {
    var edges = [];
    var MD = maxDist || 0.48;
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[i].ox - nodes[j].ox;
        var dy = nodes[i].oy - nodes[j].oy;
        var dz = nodes[i].oz - nodes[j].oz;
        var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < MD) edges.push([i, j, dist]);
      }
    }
    return edges;
  }

  // Inner core nodes (smaller sphere inside)
  var coreNodes = [];
  var coreEdges = [];

  // Orbiting ring particles
  var RING_PARTICLES = 120;
  var ringParticles = [];

  function initRingParticles() {
    ringParticles = [];
    for (var i = 0; i < RING_PARTICLES; i++) {
      var angle = (i / RING_PARTICLES) * Math.PI * 2;
      ringParticles.push({
        angle: angle,
        radius: SPHERE_R * (1.15 + Math.random() * 0.15),
        speed: 0.002 + Math.random() * 0.004,
        size: 0.5 + Math.random() * 1.5,
        alpha: 0.2 + Math.random() * 0.5,
        tilt: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  // Floating dust particles in background
  var DUST_COUNT = 80;
  var DUST = [];
  for (var di = 0; di < DUST_COUNT; di++) {
    DUST.push({
      x: Math.random(), y: Math.random(),
      vx: (Math.random()-0.5)*0.0004,
      vy: (Math.random()-0.5)*0.0004,
      r: Math.random()*1.8+0.3,
      alpha: Math.random()*0.35+0.05,
      hue: Math.random() > 0.5 ? 330 : 280,
    });
  }

  // -- SOLAR SYSTEM: Planet Definitions --
  var PLANET_DATA = [
    {
      name: 'MERCURY', orbitMul: 1.35, sizeMul: 0.08, speed: 0.012, hue: 40, nodeCount: 15,
      files: ['.env', 'config.json', '.gitignore', 'tsconfig.json', 'package.json', '.env.local', '.env.prod', 'babel.config.js', 'jest.config.js', 'manifest.json', 'robots.txt', 'sitemap.xml', 'humans.txt', '.editorconfig', 'prettier.config.js']
    },
    {
      name: 'VENUS', orbitMul: 1.55, sizeMul: 0.10, speed: 0.009, hue: 50, nodeCount: 18,
      files: ['main.css', 'theme.css', 'layout.css', 'jarvis.css', 'variables.css', 'reset.css', 'animations.css', 'responsive.css', 'components.css', 'utilities.css', 'typography.css', 'grid.css', 'forms.css', 'buttons.css', 'cards.css', 'modal.css', 'tooltip.css', 'sidebar.css']
    },
    {
      name: 'EARTH', orbitMul: 1.8, sizeMul: 0.12, speed: 0.007, hue: 200, nodeCount: 22,
      files: ['index.html', 'main.js', 'renderer.js', 'app.js', 'server.js', 'client.js', 'router.js', 'store.js', 'actions.js', 'reducer.js', 'context.js', 'hooks.js', 'utils.js', 'helpers.js', 'constants.js', 'types.ts', 'interface.ts', 'enum.ts', 'validators.js', 'formatters.js', 'logger.js', 'events.js']
    },
    {
      name: 'MARS', orbitMul: 2.05, sizeMul: 0.09, speed: 0.006, hue: 10, nodeCount: 16,
      files: ['Dockerfile', 'docker-compose.yml', 'deploy.sh', 'Makefile', 'Procfile', 'nginx.conf', 'webpack.config.js', 'rollup.config.js', 'vite.config.js', 'build.sh', 'ci.yml', 'cd.yml', 'start.sh', 'setup.sh', 'install.sh', 'migrate.js']
    },
    {
      name: 'JUPITER', orbitMul: 2.45, sizeMul: 0.18, speed: 0.004, hue: 30, nodeCount: 28,
      files: ['node_modules/', 'vendor/', 'lib/', 'src/', 'dist/', 'build/', 'public/', 'assets/', 'static/', 'media/', 'uploads/', 'downloads/', 'cache/', 'temp/', 'backup/', 'logs/', 'scripts/', 'tools/', 'plugins/', 'extensions/', 'packages/', 'modules/', 'components/', 'pages/', 'views/', 'layouts/', 'templates/', 'services/']
    },
    {
      name: 'SATURN', orbitMul: 2.85, sizeMul: 0.15, speed: 0.003, hue: 45, nodeCount: 22,
      files: ['sidebar.js', 'navbar.js', 'header.js', 'footer.js', 'hero.js', 'card.js', 'list.js', 'table.js', 'form.js', 'input.js', 'button.js', 'icon.js', 'avatar.js', 'badge.js', 'alert.js', 'toast.js', 'spinner.js', 'skeleton.js', 'progress.js', 'slider.js', 'switch.js', 'carousel.js']
    },
    {
      name: 'URANUS', orbitMul: 3.25, sizeMul: 0.11, speed: 0.002, hue: 175, nodeCount: 18,
      files: ['test/', 'spec/', 'README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'docs/', 'examples/', 'tutorials/', 'guides/', 'api-docs/', 'wiki/', 'faq.md', 'help.md', 'about.md', 'security.md', 'code_of_conduct.md', 'architecture.md']
    },
    {
      name: 'NEPTUNE', orbitMul: 3.6, sizeMul: 0.10, speed: 0.0015, hue: 220, nodeCount: 16,
      files: ['database.db', 'data.json', 'schema.sql', 'seeds/', 'fixtures/', 'migrations/', 'models/', 'repositories/', 'queries/', 'mutations/', 'resolvers/', 'subscriptions/', 'graphql/', 'rest/', 'api/', 'endpoints/']
    },
  ];

  var planets = [];

  function initPlanets() {
    planets = [];
    PLANET_DATA.forEach(function(pd, idx) {
      var orbitRadius = SPHERE_R * pd.orbitMul;
      var planetRadius = SPHERE_R * pd.sizeMul;
      var pNodes = makeSphereNodes(pd.nodeCount, planetRadius);
      pNodes.forEach(function(n, i) { n.label = pd.files[i % pd.files.length]; });
      var pEdges = buildEdges(pNodes, 0.6);
      planets.push({
        name: pd.name,
        orbitRadius: orbitRadius,
        planetRadius: planetRadius,
        speed: pd.speed,
        hue: pd.hue,
        angle: (idx / PLANET_DATA.length) * Math.PI * 2, // FIXED position angle
        nodes: pNodes,
        edges: pEdges,
        tilt: 0.18 + idx * 0.02,
        rotAngle: 0,
        fileLabels: pd.files, // Store original file list
        screenX: 0, screenY: 0, // For click detection
      });
    });
  }

  // -- Focus on a planet (click to enter) --
  function focusOnPlanet(idx) {
    var planet = planets[idx];
    focusedPlanet = planet;
    showPlanets = false;

    // Backup original SUN labels
    if (!originalFileLabels) {
      originalFileLabels = sphereNodes.map(function(n) { return n.label; });
    }

    // Rebuild main sphere with planet's file labels
    sphereNodes = makeSphereNodes(NODE_COUNT, SPHERE_R);
    sphereNodes.forEach(function(n, i) {
      n.label = planet.fileLabels[i % planet.fileLabels.length];
    });
    sphereEdges = buildEdges(sphereNodes, 0.48);
    coreNodes = makeSphereNodes(60, SPHERE_R * 0.35);
    coreEdges = buildEdges(coreNodes, 0.6);
  }

  // -- Back to Solar System overview --
  function backToSolarSystem() {
    focusedPlanet = null;
    showPlanets = true;

    // Restore SUN sphere with original labels
    sphereNodes = makeSphereNodes(NODE_COUNT, SPHERE_R);
    if (originalFileLabels) {
      sphereNodes.forEach(function(n, i) {
        n.label = originalFileLabels[i % originalFileLabels.length];
      });
    } else {
      sphereNodes.forEach(function(n, i) {
        n.label = FILE_LABELS[i % FILE_LABELS.length];
      });
    }
    sphereEdges = buildEdges(sphereNodes, 0.48);
    coreNodes = makeSphereNodes(60, SPHERE_R * 0.35);
    coreEdges = buildEdges(coreNodes, 0.6);
  }

  // -- Click handler for planet selection --
  if (bgCanvas) {
    bgCanvas.addEventListener('click', function(e) {
      if (!jarvisActive || !showPlanets) return;
      for (var i = 0; i < planets.length; i++) {
        var p = planets[i];
        var dx = e.clientX - p.screenX;
        var dy = e.clientY - p.screenY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var hitRadius = Math.max(p.planetRadius * sphereScaleCurrent * 2.5, 35);
        if (dist < hitRadius) {
          focusOnPlanet(i);
          break;
        }
      }
    });
  }

  // -- HSL color helper --
  function hsl(h, s, l, a) {
    return 'hsla(' + h + ', ' + s + '%, ' + l + '%, ' + a + ')';
  }

  // -- Mood Color Cycling System --
  var MOOD_PALETTES = [
    { name: 'Sakura',   baseHue: 330, bgTint: '#0d0018' },
    { name: 'Ocean',    baseHue: 200, bgTint: '#000d18' },
    { name: 'Aurora',   baseHue: 140, bgTint: '#001a0d' },
    { name: 'Sunset',   baseHue: 25,  bgTint: '#1a0800' },
    { name: 'Violet',   baseHue: 280, bgTint: '#0d0018' },
    { name: 'Ice',      baseHue: 190, bgTint: '#001018' },
    { name: 'Lava',     baseHue: 5,   bgTint: '#180500' },
    { name: 'Neon',     baseHue: 60,  bgTint: '#0a0d00' },
    { name: 'Cosmic',   baseHue: 260, bgTint: '#08001a' },
    { name: 'Rose',     baseHue: 350, bgTint: '#1a000d' },
  ];
  var currentPaletteIdx = 0;
  var nextPaletteIdx = 1;
  var paletteLerpT = 0;
  var paletteChangeInterval = 12; // seconds between palette changes
  var currentBaseHue = MOOD_PALETTES[0].baseHue;

  function lerpHue(a, b, t) {
    // Shortest path around the hue wheel
    var diff = b - a;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    var result = a + diff * t;
    if (result < 0) result += 360;
    if (result >= 360) result -= 360;
    return result;
  }

  function lerpColor(c1, c2, t) {
    // Lerp hex colors
    var r1 = parseInt(c1.slice(1,3), 16), g1 = parseInt(c1.slice(3,5), 16), b1 = parseInt(c1.slice(5,7), 16);
    var r2 = parseInt(c2.slice(1,3), 16), g2 = parseInt(c2.slice(3,5), 16), b2 = parseInt(c2.slice(5,7), 16);
    var r = Math.round(r1 + (r2 - r1) * t);
    var g = Math.round(g1 + (g2 - g1) * t);
    var b = Math.round(b1 + (b2 - b1) * t);
    return '#' + ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
  }

  // -- DRAW FRAME --
  function drawFrame(ts) {
    if (!bgCtx) return;
    bgCtx.clearRect(0, 0, W, H);

    t = ts * 0.001;
    autoRotY += 0.003;

    // -- Update mood color palette --
    paletteLerpT += (1 / 60) / paletteChangeInterval; // approx 60fps
    if (paletteLerpT >= 1) {
      paletteLerpT = 0;
      currentPaletteIdx = nextPaletteIdx;
      nextPaletteIdx = (nextPaletteIdx + 1) % MOOD_PALETTES.length;
    }
    var smoothT = paletteLerpT * paletteLerpT * (3 - 2 * paletteLerpT); // smoothstep
    currentBaseHue = lerpHue(MOOD_PALETTES[currentPaletteIdx].baseHue, MOOD_PALETTES[nextPaletteIdx].baseHue, smoothT);
    var currentBgTint = lerpColor(MOOD_PALETTES[currentPaletteIdx].bgTint, MOOD_PALETTES[nextPaletteIdx].bgTint, smoothT);
    var H2 = (currentBaseHue + 120) % 360; // complementary offset
    var H3 = (currentBaseHue + 60) % 360;  // triadic offset

    // -- Mouse-driven rotation --
    mouseCurrent.x += (mouseTarget.x - mouseCurrent.x) * 0.06;
    mouseCurrent.y += (mouseTarget.y - mouseCurrent.y) * 0.06;

    var targetRotY = (mouseCurrent.x - 0.5) * Math.PI * 2.5;
    var targetRotX = (mouseCurrent.y - 0.5) * Math.PI * 1.5;

    var Kdrive = mouseDown ? 0.08 : 0.02;
    sphereRotYvel += (targetRotY - sphereRotY) * Kdrive;
    sphereRotXvel += (targetRotX - sphereRotX) * Kdrive;
    sphereRotYvel *= 0.90;
    sphereRotXvel *= 0.90;
    sphereRotY += sphereRotYvel;
    sphereRotX += sphereRotXvel;

    var finalRotY = sphereRotY + autoRotY;
    var cx = W / 2, cy = H / 2;

    // -- Deep space background (mood tinted) --
    var bg = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    bg.addColorStop(0, currentBgTint);
    bg.addColorStop(0.4, hsl(currentBaseHue, 30, 3, 1));
    bg.addColorStop(1, '#000003');
    bgCtx.fillStyle = bg;
    bgCtx.fillRect(0, 0, W, H);

    // -- Outer ambient glow (breathing) --
    var breathe = 0.5 + 0.5 * Math.sin(t * 0.8);
    var glowR = SPHERE_R * 1.6;
    var outerGlow = bgCtx.createRadialGradient(cx, cy, SPHERE_R * 0.1, cx, cy, glowR);
    outerGlow.addColorStop(0, hsl(currentBaseHue, 100, 50, 0.06 + 0.03 * breathe));
    outerGlow.addColorStop(0.3, hsl(H3, 80, 40, 0.04));
    outerGlow.addColorStop(0.6, hsl(H2, 90, 50, 0.02));
    outerGlow.addColorStop(1, 'transparent');
    bgCtx.beginPath();
    bgCtx.arc(cx, cy, glowR, 0, Math.PI * 2);
    bgCtx.fillStyle = outerGlow;
    bgCtx.fill();

    // -- Inner core glow (bright center) --
    var coreGlow = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, SPHERE_R * 0.4);
    coreGlow.addColorStop(0, hsl(currentBaseHue - 20, 100, 70, 0.15 + 0.08 * breathe));
    coreGlow.addColorStop(0.5, hsl(currentBaseHue, 100, 50, 0.06));
    coreGlow.addColorStop(1, 'transparent');
    bgCtx.beginPath();
    bgCtx.arc(cx, cy, SPHERE_R * 0.4, 0, Math.PI * 2);
    bgCtx.fillStyle = coreGlow;
    bgCtx.fill();

    // -- Draw inner core sphere (small neural net inside) --
    var coreProjected = coreNodes.map(function(n) {
      var pulse = 0.9 + 0.1 * Math.sin(t * n.speed * 15 + n.pulse);
      var r1 = rotY(n.ox, n.oy, n.oz, finalRotY * 1.5);
      var r2 = rotX(r1.x, r1.y, r1.z, sphereRotX * 1.2);
      return {
        px: cx + r2.x * n.r * pulse,
        py: cy + r2.y * n.r * pulse,
        depth: (r2.z + 1) / 2, z: r2.z
      };
    });

    // Core edges
    coreEdges.forEach(function(edge) {
      var a = coreProjected[edge[0]], b = coreProjected[edge[1]], dist = edge[2];
      var avgDepth = (a.depth + b.depth) / 2;
      var alpha = avgDepth * 0.5 * (1 - dist / 0.6);
      if (alpha < 0.02) return;
      bgCtx.beginPath();
      bgCtx.moveTo(a.px, a.py);
      bgCtx.lineTo(b.px, b.py);
      bgCtx.strokeStyle = hsl(currentBaseHue - 30, 100, 70, alpha * 0.6);
      bgCtx.lineWidth = 0.5;
      bgCtx.stroke();
    });

    // Core nodes
    coreProjected.forEach(function(p) {
      var r = 1.5 * p.depth + 0.5;
      bgCtx.beginPath();
      bgCtx.arc(p.px, p.py, r, 0, Math.PI * 2);
      bgCtx.fillStyle = hsl(currentBaseHue - 20, 100, 80, 0.3 + p.depth * 0.4);
      bgCtx.fill();
    });

    // -- Mouse scroll driven scale (smooth lerp) --
    sphereScaleCurrent += (sphereScaleTarget - sphereScaleCurrent) * 0.08;
    var sphereScale = sphereScaleCurrent;

    // -- Project main sphere nodes --
    var projected = sphereNodes.map(function(n, idx) {
      var pulse = 0.94 + 0.06 * Math.sin(t * n.speed * 10 + n.pulse);
      var scaledR = n.r * sphereScale;
      var r1 = rotY(n.ox, n.oy, n.oz, finalRotY);
      var r2 = rotX(r1.x, r1.y, r1.z, sphereRotX);
      return {
        px: cx + r2.x * scaledR * pulse,
        py: cy + r2.y * scaledR * pulse,
        depth: (r2.z + 1) / 2, z: r2.z,
        label: n.label || ''
      };
    });

    // -- Draw edges with gradient colors --
    sphereEdges.forEach(function(edge) {
      var a = projected[edge[0]], b = projected[edge[1]], dist = edge[2];
      var avgDepth = (a.depth + b.depth) / 2;
      var alpha = avgDepth * 0.6 * (1 - dist / 0.48);
      if (alpha < 0.02) return;

      bgCtx.beginPath();
      bgCtx.moveTo(a.px, a.py);
      bgCtx.lineTo(b.px, b.py);

      // Color shifts based on depth using current mood hue
      var hue = currentBaseHue - avgDepth * 120;
      bgCtx.strokeStyle = hsl(hue, 90, 55 + avgDepth * 20, alpha);
      bgCtx.lineWidth = 0.6 + avgDepth * 0.6;
      bgCtx.stroke();
    });

    // -- Draw nodes with glow --
    projected.forEach(function(p) {
      var r = 2.2 * p.depth + 0.6;
      var alpha = 0.3 + p.depth * 0.7;
      bgCtx.beginPath();
      bgCtx.arc(p.px, p.py, r, 0, Math.PI * 2);

      var nodeHue = currentBaseHue;
      if (p.depth > 0.65) {
        nodeHue = currentBaseHue - p.depth * 60;
        bgCtx.fillStyle = hsl(nodeHue, 100, 70, alpha);
        bgCtx.shadowColor = hsl(nodeHue, 100, 60, 1);
        bgCtx.shadowBlur = 12;
      } else {
        bgCtx.fillStyle = hsl(currentBaseHue - 50, 60, 50, alpha * 0.5);
        bgCtx.shadowBlur = 0;
      }
      bgCtx.fill();
      bgCtx.shadowBlur = 0;

      // -- File label on front-facing nodes --
      if (p.depth > 0.55 && p.label) {
        var labelAlpha = (p.depth - 0.55) * 2.2;
        if (labelAlpha > 1) labelAlpha = 1;
        var isFolder = p.label.indexOf('/') !== -1;
        var fontSize = isFolder ? 9 : 8;
        bgCtx.font = (isFolder ? 'bold ' : '') + fontSize + 'px Orbitron, monospace';
        bgCtx.fillStyle = isFolder
          ? hsl(H3, 100, 70, labelAlpha * 0.85)
          : hsl(H2, 90, 80, labelAlpha * 0.7);
        bgCtx.textAlign = 'center';
        bgCtx.fillText(p.label, p.px, p.py - r - 4);
      }
    });

    // -- SUN / PLANET label + rays --
    if (focusedPlanet) {
      // Show focused planet name instead of SUN
      bgCtx.font = 'bold 13px Orbitron, sans-serif';
      bgCtx.fillStyle = hsl(focusedPlanet.hue, 100, 85, 0.8 + 0.15 * Math.sin(t * 1.5));
      bgCtx.textAlign = 'center';
      bgCtx.fillText('\u25C9 ' + focusedPlanet.name, cx, cy + SPHERE_R * sphereScale + 22);

      // "BACK" button text
      bgCtx.font = 'bold 11px Orbitron, sans-serif';
      bgCtx.fillStyle = hsl(currentBaseHue, 80, 75, 0.6 + 0.2 * Math.sin(t * 2));
      bgCtx.textAlign = 'left';
      bgCtx.fillText('\u25C0 BACK TO SOLAR SYSTEM [Backspace]', 30, 80);
    } else {
      // SUN label
      bgCtx.font = 'bold 11px Orbitron, sans-serif';
      bgCtx.fillStyle = hsl(currentBaseHue, 100, 85, 0.7 + 0.2 * Math.sin(t * 1.5));
      bgCtx.textAlign = 'center';
      bgCtx.fillText('\u2600 S U N', cx, cy + SPHERE_R * sphereScale + 22);
    }

    // Sun/Planet corona rays
    var rayHue = focusedPlanet ? focusedPlanet.hue : currentBaseHue;
    for (var sri = 0; sri < 20; sri++) {
      var srayAngle = (sri / 20) * Math.PI * 2 + t * 0.25;
      var srayInner = SPHERE_R * 1.08 * sphereScale;
      var srayOuter = SPHERE_R * (1.18 + 0.06 * Math.sin(t * 2.5 + sri * 0.8)) * sphereScale;
      var srx1 = cx + Math.cos(srayAngle) * srayInner;
      var sry1 = cy + Math.sin(srayAngle) * srayInner;
      var srx2 = cx + Math.cos(srayAngle) * srayOuter;
      var sry2 = cy + Math.sin(srayAngle) * srayOuter;
      bgCtx.beginPath();
      bgCtx.moveTo(srx1, sry1);
      bgCtx.lineTo(srx2, sry2);
      bgCtx.strokeStyle = hsl(rayHue, 100, 75, 0.12 + 0.08 * Math.sin(t * 3 + sri));
      bgCtx.lineWidth = 1.2;
      bgCtx.stroke();
    }

    // -- SOLAR SYSTEM: Draw planets at FIXED positions --
    if (showPlanets) {
      planets.forEach(function(planet, pIdx) {
        // Gentle self-rotation only (NO orbit movement)
        planet.rotAngle += 0.006;

        // FIXED position (angle never changes)
        var pOrbitX = Math.cos(planet.angle) * planet.orbitRadius * sphereScale;
        var pOrbitY = Math.sin(planet.angle) * planet.orbitRadius * planet.tilt * sphereScale;

        var planetCX = cx + pOrbitX;
        var planetCY = cy + pOrbitY;

        // Store screen position for click detection
        planet.screenX = planetCX;
        planet.screenY = planetCY;

        // Draw orbit path (subtle dotted circle)
        bgCtx.beginPath();
        bgCtx.ellipse(cx, cy,
          planet.orbitRadius * sphereScale,
          planet.orbitRadius * planet.tilt * sphereScale,
          0, 0, Math.PI * 2);
        bgCtx.strokeStyle = hsl(planet.hue, 50, 45, 0.04 + 0.02 * Math.sin(t * 0.5 + pIdx));
        bgCtx.lineWidth = 0.6;
        bgCtx.setLineDash([4, 6]);
        bgCtx.stroke();
        bgCtx.setLineDash([]);

        // Connection line from sun to planet
        bgCtx.beginPath();
        bgCtx.moveTo(cx, cy);
        bgCtx.lineTo(planetCX, planetCY);
        var lineGrad = bgCtx.createLinearGradient(cx, cy, planetCX, planetCY);
        lineGrad.addColorStop(0, hsl(currentBaseHue, 80, 60, 0.1));
        lineGrad.addColorStop(0.5, hsl(planet.hue, 60, 50, 0.06));
        lineGrad.addColorStop(1, hsl(planet.hue, 80, 60, 0.12));
        bgCtx.strokeStyle = lineGrad;
        bgCtx.lineWidth = 0.4;
        bgCtx.stroke();

        // Planet glow
        var pGlowR = planet.planetRadius * sphereScale * 2.5;
        var pGlow = bgCtx.createRadialGradient(planetCX, planetCY, 0, planetCX, planetCY, pGlowR);
        pGlow.addColorStop(0, hsl(planet.hue, 100, 60, 0.18));
        pGlow.addColorStop(0.5, hsl(planet.hue, 80, 50, 0.06));
        pGlow.addColorStop(1, 'transparent');
        bgCtx.beginPath();
        bgCtx.arc(planetCX, planetCY, pGlowR, 0, Math.PI * 2);
        bgCtx.fillStyle = pGlow;
        bgCtx.fill();

        // Project planet's mini-sphere nodes
        var pProjected = planet.nodes.map(function(n) {
          var pulse = 0.92 + 0.08 * Math.sin(t * n.speed * 12 + n.pulse);
          var r1 = rotY(n.ox, n.oy, n.oz, planet.rotAngle);
          var r2 = rotX(r1.x, r1.y, r1.z, planet.rotAngle * 0.6);
          return {
            px: planetCX + r2.x * n.r * pulse * sphereScale,
            py: planetCY + r2.y * n.r * pulse * sphereScale,
            depth: (r2.z + 1) / 2,
            z: r2.z,
            label: n.label || ''
          };
        });

        // Draw planet edges
        planet.edges.forEach(function(edge) {
          var a = pProjected[edge[0]], b = pProjected[edge[1]], dist = edge[2];
          var avgDepth = (a.depth + b.depth) / 2;
          var alpha = avgDepth * 0.45 * (1 - dist / 0.6);
          if (alpha < 0.015) return;
          bgCtx.beginPath();
          bgCtx.moveTo(a.px, a.py);
          bgCtx.lineTo(b.px, b.py);
          bgCtx.strokeStyle = hsl(planet.hue, 80, 55 + avgDepth * 20, alpha);
          bgCtx.lineWidth = 0.35 + avgDepth * 0.3;
          bgCtx.stroke();
        });

        // Draw planet nodes
        pProjected.forEach(function(p) {
          var r = 1.4 * p.depth + 0.4;
          var alpha = 0.2 + p.depth * 0.6;
          bgCtx.beginPath();
          bgCtx.arc(p.px, p.py, r, 0, Math.PI * 2);
          if (p.depth > 0.55) {
            bgCtx.fillStyle = hsl(planet.hue, 100, 70, alpha);
            bgCtx.shadowColor = hsl(planet.hue, 100, 60, 1);
            bgCtx.shadowBlur = 6;
          } else {
            bgCtx.fillStyle = hsl(planet.hue, 50, 45, alpha * 0.35);
            bgCtx.shadowBlur = 0;
          }
          bgCtx.fill();
          bgCtx.shadowBlur = 0;

          // File labels on front nodes
          if (p.depth > 0.58 && p.label) {
            var lAlpha = (p.depth - 0.58) * 2.4;
            if (lAlpha > 1) lAlpha = 1;
            var isFolder = p.label.indexOf('/') !== -1;
            var fSize = isFolder ? 7 : 6;
            bgCtx.font = (isFolder ? 'bold ' : '') + fSize + 'px Orbitron, monospace';
            bgCtx.fillStyle = isFolder
              ? hsl(planet.hue + 80, 100, 75, lAlpha * 0.8)
              : hsl(planet.hue + 40, 90, 80, lAlpha * 0.65);
            bgCtx.textAlign = 'center';
            bgCtx.fillText(p.label, p.px, p.py - r - 3);
          }
        });

        // Saturn-specific rings
        if (planet.name === 'SATURN') {
          for (var si = 0; si < 2; si++) {
            bgCtx.beginPath();
            bgCtx.ellipse(planetCX, planetCY,
              planet.planetRadius * sphereScale * (1.6 + si * 0.25),
              planet.planetRadius * sphereScale * 0.15,
              planet.rotAngle * 0.3, 0, Math.PI * 2);
            bgCtx.strokeStyle = hsl(planet.hue, 80, 65, 0.2 - si * 0.05);
            bgCtx.lineWidth = 1.2 - si * 0.3;
            bgCtx.stroke();
          }
        }

        // Planet name label + "CLICK" hint
        bgCtx.font = 'bold 9px Orbitron, sans-serif';
        bgCtx.fillStyle = hsl(planet.hue, 100, 80, 0.6);
        bgCtx.textAlign = 'center';
        bgCtx.fillText(planet.name, planetCX, planetCY + planet.planetRadius * sphereScale + 12);

        // Hover hint (cursor style set via CSS)
        bgCtx.font = '7px Orbitron, sans-serif';
        bgCtx.fillStyle = hsl(planet.hue, 80, 70, 0.35);
        bgCtx.fillText('[ CLICK ]', planetCX, planetCY + planet.planetRadius * sphereScale + 22);
      });
    }

    // -- Orbiting rings --
    ringParticles.forEach(function(rp) {
      rp.angle += rp.speed;
      var rx = Math.cos(rp.angle) * rp.radius;
      var ry = Math.sin(rp.angle) * rp.radius * 0.1 + rp.tilt * rp.radius * Math.sin(rp.angle);
      var rz = Math.sin(rp.angle) * rp.radius * 0.3;
      var r1 = rotY(rx, ry, rz, finalRotY * 0.5);
      var r2 = rotX(r1.x, r1.y, r1.z, sphereRotX * 0.3);
      var depth = (r2.z / (SPHERE_R * 1.3) + 1) / 2;

      bgCtx.beginPath();
      bgCtx.arc(cx + r2.x, cy + r2.y, rp.size * (0.5 + depth * 0.5), 0, Math.PI * 2);
      bgCtx.fillStyle = hsl(currentBaseHue, 100, 75, rp.alpha * depth);
      bgCtx.fill();
    });

    // -- Second ring (tilted 90 degrees) --
    for (var ri = 0; ri < ringParticles.length; ri += 2) {
      var rp = ringParticles[ri];
      var a2 = rp.angle + Math.PI * 0.5;
      var rx2 = Math.cos(a2) * rp.radius * 0.9;
      var ry2 = Math.sin(a2) * rp.radius * 0.9 * 0.08;
      var rz2 = Math.sin(a2) * rp.radius * 0.9;
      var r1b = rotZ(rx2, ry2, rz2, Math.PI * 0.4);
      var r2b = rotY(r1b.x, r1b.y, r1b.z, finalRotY * 0.3);
      var r3b = rotX(r2b.x, r2b.y, r2b.z, sphereRotX * 0.2);
      var depth2 = (r3b.z / (SPHERE_R * 1.3) + 1) / 2;

      bgCtx.beginPath();
      bgCtx.arc(cx + r3b.x, cy + r3b.y, rp.size * 0.7 * (0.5 + depth2 * 0.5), 0, Math.PI * 2);
      bgCtx.fillStyle = hsl(H2, 100, 70, rp.alpha * 0.5 * depth2);
      bgCtx.fill();
    }

    // -- Equator ellipse rings --
    for (var ei = 0; ei < 3; ei++) {
      var ringTilt = ei * 0.3;
      var ringAlpha = 0.06 + 0.04 * Math.sin(t * 1.5 + ei);
      bgCtx.beginPath();
      bgCtx.ellipse(cx, cy, SPHERE_R * (1.05 + ei * 0.05),
        SPHERE_R * Math.abs(Math.cos(sphereRotX + ringTilt)) * 0.1 + 3,
        finalRotY + ei * 0.5, 0, Math.PI * 2);
      bgCtx.strokeStyle = hsl(currentBaseHue - ei * 40, 80, 60, ringAlpha);
      bgCtx.lineWidth = 0.8;
      bgCtx.stroke();
    }

    // -- Outer boundary circle --
    bgCtx.beginPath();
    bgCtx.arc(cx, cy, SPHERE_R * 1.08, 0, Math.PI * 2);
    bgCtx.strokeStyle = hsl(currentBaseHue, 100, 50, 0.04 + 0.03 * Math.sin(t * 1.3));
    bgCtx.lineWidth = 1.5;
    bgCtx.stroke();

    // -- Dust particles --
    DUST.forEach(function(d) {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0) d.x = 1; if (d.x > 1) d.x = 0;
      if (d.y < 0) d.y = 1; if (d.y > 1) d.y = 0;
      bgCtx.beginPath();
      bgCtx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
      bgCtx.fillStyle = hsl(currentBaseHue + (d.hue - 330), 80, 75, d.alpha);
      bgCtx.fill();
    });

    // -- Mouse cursor glow on sphere --
    var hx = cx + (mouseCurrent.x - 0.5) * W * 0.5;
    var hy = cy + (mouseCurrent.y - 0.5) * H * 0.5;
    var cursorGlow = bgCtx.createRadialGradient(hx, hy, 0, hx, hy, 40);
    cursorGlow.addColorStop(0, hsl(currentBaseHue, 100, 70, 0.12));
    cursorGlow.addColorStop(1, 'transparent');
    bgCtx.beginPath();
    bgCtx.arc(hx, hy, 40, 0, Math.PI * 2);
    bgCtx.fillStyle = cursorGlow;
    bgCtx.fill();

    animFrame = requestAnimationFrame(drawFrame);
  }

  // -- Waveform canvas --
  var waveCtx = waveCanvas ? waveCanvas.getContext('2d') : null;
  var waveT = 0;
  var voiceEnergy = 0;

  function drawWave() {
    if (!waveCtx || !waveCanvas) return;
    waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
    var bars = 80;
    var barW = waveCanvas.width / bars;
    waveT += 0.08;

    for (var i = 0; i < bars; i++) {
      var base = Math.sin(i * 0.2 + waveT) * 6 + Math.sin(i * 0.05 + waveT * 0.5) * 3;
      var energy = voiceEnergy * (24 + Math.random() * 20);
      var h = Math.max(3, Math.abs(base) + energy);
      var x = i * barW;
      var y = waveCanvas.height / 2 - h / 2;
      var alpha = voiceEnergy > 0.05 ? 0.8 : 0.25;
      waveCtx.fillStyle = voiceEnergy > 0.05
        ? 'rgba(255,80,80,' + alpha + ')'
        : 'rgba(255,105,180,' + alpha + ')';
      waveCtx.beginPath();
      waveCtx.roundRect(x + 1, y, barW - 2, h, 2);
      waveCtx.fill();
    }

    voiceEnergy *= 0.88;
    if (jarvisActive) requestAnimationFrame(drawWave);
  }

  // -- HUD clock --
  function tickClock() {
    if (!jarvisActive || !jhudTime) return;
    var n = new Date();
    jhudTime.textContent = n.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    setTimeout(tickClock, 1000);
  }

  function setStatus(text, cls) {
    if (!jhudStatusVal) return;
    jhudStatusVal.textContent = text;
    if (jvoiceLabel) {
      jvoiceLabel.className = '';
      jvoiceLabel.classList.add(cls || 'jvoice-idle');
      var labelMap = {
        'jvoice-idle':      '[ VOICE ACTIVE ] - SPEAK ANYTIME',
        'jvoice-listening': '[ LISTENING... ]',
        'jvoice-thinking':  '[ PROCESSING... ]',
        'jvoice-speaking':  '[ SPEAKING ]',
      };
      jvoiceLabel.textContent = labelMap[cls] || '[ VOICE ACTIVE ] - SPEAK ANYTIME';
    }
  }

  function setResponse(text) {
    if (!jresponseText) return;
    jresponseText.style.animation = 'none';
    jresponseText.offsetHeight;
    jresponseText.style.animation = '';
    jresponseText.textContent = text;
  }

  // -- AI Response --
  async function sendToAI(text) {
    if (!text || !window.dvsc) return;
    setResponse('...');
    setStatus('PROCESSING', 'jvoice-thinking');
    if (jvoiceTranscript) jvoiceTranscript.textContent = '"' + text + '"';

    try {
      var result = await window.dvsc.sendMessage(text);
      if (result.success) {
        var reply = result.response || '...';
        setResponse(reply);
        setStatus('SPEAKING', 'jvoice-speaking');
        if (typeof window.speak === 'function') await window.speak(reply);
        setStatus('STANDBY', 'jvoice-idle');
        if (jvoiceTranscript) jvoiceTranscript.textContent = '';
      } else {
        setResponse('Error: ' + result.error);
        setStatus('ERROR', 'jvoice-idle');
      }
    } catch(e) {
      setResponse('System error: ' + e.message);
      setStatus('ERROR', 'jvoice-idle');
    }
  }

  // -- Voice Activity Detection (VAD) with MediaRecorder --
  var vadAudioContext = null;
  var vadAnalyser = null;
  var vadMicrophone = null;
  var vadRecorder = null;
  var vadChunks = [];
  var isRecording = false;
  var silenceTimer = null;
  var listenLoopActive = false;

  async function initSpeechRecognition() {
    listenLoopActive = true;
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      vadAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      vadAnalyser = vadAudioContext.createAnalyser();
      vadMicrophone = vadAudioContext.createMediaStreamSource(stream);
      vadMicrophone.connect(vadAnalyser);
      vadAnalyser.fftSize = 256;
      var bufferLength = vadAnalyser.frequencyBinCount;
      var dataArray = new Uint8Array(bufferLength);

      vadRecorder = new MediaRecorder(stream);

      vadRecorder.ondataavailable = function(e) {
        if (e.data.size > 0) vadChunks.push(e.data);
      };

      vadRecorder.onstop = async function() {
        if (vadChunks.length > 0) {
          var blob = new Blob(vadChunks, { type: 'audio/webm' });
          vadChunks = [];
          if (listenLoopActive) await processAudioChunk(blob);
        }
        if (listenLoopActive) checkAudioLevel();
      };

      setStatus('LISTENING', 'jvoice-listening');

      function checkAudioLevel() {
        if (!listenLoopActive) return;
        vadAnalyser.getByteFrequencyData(dataArray);
        var sum = 0;
        for (var i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
        var average = sum / bufferLength;

        // Drive the waveform visually
        voiceEnergy = average / 128.0;

        var threshold = 30;

        if (average > threshold) {
          if (!isRecording) {
            isRecording = true;
            vadChunks = [];
            vadRecorder.start();
          }
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(function() {
            if (isRecording) {
              isRecording = false;
              vadRecorder.stop();
            }
          }, 1500);
        }

        if (!isRecording) {
          requestAnimationFrame(checkAudioLevel);
        }
      }

      checkAudioLevel();
    } catch (err) {
      console.warn('[SENJU] VAD error:', err);
      if (jvoiceLabel) jvoiceLabel.textContent = '[ MIC PERMISSION DENIED ]';
    }
  }

  async function processAudioChunk(blob) {
    if (!listenLoopActive) return;
    try {
      var storedSettings = await window.dvsc.getSettings();
      var apiKey = storedSettings && storedSettings.apiKey;
      if (!apiKey) {
        setResponse('API key not set for Voice.');
        return;
      }

      var formData = new FormData();
      formData.append('file', new File([blob], 'voice.webm', { type: 'audio/webm' }));
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'hi');
      formData.append('prompt', 'Vivek SENJU command hindi english');

      var res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey },
        body: formData
      });

      if (!res.ok) return;
      var data = await res.json();
      var text = (data.text || '').trim();

      if (text.length > 3) {
        var lower = text.toLowerCase();

        // Filter out common Whisper API hallucinations on silence
        var hallucinations = [
          'thank you', 'thanks for watching', 'please subscribe', 'subscribe to my',
          'subtitles by', 'bye.', 'you.', 'thank you.', 'subscribe', 'watching'
        ];

        var isHallucination = false;
        for (var hi = 0; hi < hallucinations.length; hi++) {
          if (lower.indexOf(hallucinations[hi]) !== -1 && text.length < 35) {
            isHallucination = true;
            break;
          }
        }

        if (isHallucination) {
           console.log('[SENJU] Ignored hallucinated silence text:', text);
           return;
        }

        if (jvoiceTranscript) jvoiceTranscript.textContent = text;

        if (lower.indexOf('exit senju') !== -1 || lower.indexOf('band karo senju') !== -1 || lower.indexOf('close senju') !== -1 ||
            lower.indexOf('exit jarvis') !== -1 || lower.indexOf('close jarvis') !== -1 || lower.indexOf('band karo jarvis') !== -1) {
          closeSexyMode(); return;
        }
        if (lower.indexOf('naya chat') !== -1 || lower.indexOf('new chat') !== -1) {
          window.dvsc && window.dvsc.createNewChat();
          setResponse('New session started.'); return;
        }
        if (lower.indexOf('stop') !== -1 || lower.indexOf('chup') !== -1 || lower.indexOf('quiet') !== -1) {
          if (typeof window.stopAudio === 'function') window.stopAudio();
          setResponse('Audio stopped.'); setStatus('STANDBY', 'jvoice-idle'); return;
        }
        await sendToAI(text);
      }
    } catch(e) {
      console.warn('[SENJU] Transcription error:', e);
    }
  }

  function stopSpeechRecognition() {
    listenLoopActive = false;
    clearTimeout(silenceTimer);
    if (vadRecorder && vadRecorder.state !== 'inactive') {
      try { vadRecorder.stop(); } catch(e){}
    }
    if (vadAudioContext) {
      vadAudioContext.close();
      vadAudioContext = null;
    }
    if (vadMicrophone) vadMicrophone.disconnect();
  }

  // -- Open / Close --
  function openSexyMode() {
    jarvisActive = true;
    resizeBgCanvas();

    SPHERE_R = Math.min(W, H) * 0.30;
    sphereNodes = makeSphereNodes(NODE_COUNT, SPHERE_R);
    sphereEdges = buildEdges(sphereNodes, 0.48);

    // Inner core sphere (smaller, denser)
    coreNodes = makeSphereNodes(60, SPHERE_R * 0.35);
    coreEdges = buildEdges(coreNodes, 0.6);

    initRingParticles();
    initPlanets();

    jarvisOverlay.classList.add('active');
    tickClock();
    animFrame = requestAnimationFrame(drawFrame);
    requestAnimationFrame(drawWave);

    setResponse('SENJU online. Move your mouse to control the sphere. Speak naturally for commands or questions.');
    setStatus('INIT', 'jvoice-idle');

    initSpeechRecognition();
  }

  function closeSexyMode() {
    jarvisActive = false;
    jarvisOverlay.classList.remove('active');
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    stopSpeechRecognition();
    if (typeof window.stopAudio === 'function') window.stopAudio();
  }

  // -- Events --
  if (btnJarvis) btnJarvis.addEventListener('click', openSexyMode);
  if (jarvisCloseBtn) jarvisCloseBtn.addEventListener('click', closeSexyMode);
  document.addEventListener('keydown', function(e) {
    if (e.code === 'Escape' && jarvisActive) {
      if (focusedPlanet) {
        backToSolarSystem(); // First go back to solar system
      } else {
        closeSexyMode(); // Then close SENJU mode
      }
    }
    if (e.code === 'Backspace' && jarvisActive && focusedPlanet) {
      e.preventDefault();
      backToSolarSystem();
    }
  });

})();
