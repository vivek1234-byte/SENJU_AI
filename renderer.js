// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DVSC Frontend Renderer Logic
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Surface renderer errors in senju-main.log (main logs console errors/warnings)
window.addEventListener('error', (e) => console.error('[Renderer error]', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[Renderer rejection]', e.reason && (e.reason.stack || e.reason.message || e.reason)));

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
  let greetingPromise = null;

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
    greetingPromise = prefetchGreeting();

    setTimeout(() => {
      bootOverlay.style.opacity = '0';
      setTimeout(() => {
        bootOverlay.style.display = 'none';
        initializeApp();
      }, 250);
    }, maxDelay + 350);
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

    // UI is usable right away; lists load in parallel with the greeting
    loadChatsList();
    loadReminders();
    loadTimetable();
    loadAttendance();
    loadExams();
    loadTravel();
    if (settings.locationEnabled) {
      requestPreciseLocation();
    }

    // Wait for the greeting that started during boot (no second API call)
    if (settings.apiKey && !preloadedGreeting && greetingPromise) {
      await greetingPromise;
    }

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
      
      // Tool calls already ran in the main process; refresh any panels they touched
      refreshPanels(result.refresh);

      // Legacy tag support (older models / saved prompts)
      responseText = await parseStructuredTags(responseText);

      addMessage(responseText, 'assistant');
      speak(responseText);
    } else {
      addMessage(`Error: ${result.error}`, 'assistant');
    }
  }

  function refreshPanels(list) {
    if (!Array.isArray(list)) return;
    if (list.includes('reminders')) loadReminders();
    if (list.includes('timetable')) loadTimetable();
    if (list.includes('attendance')) loadAttendance();
    if (list.includes('exams')) loadExams();
    if (list.includes('travel')) loadTravel();
  }
  window.senjuRefresh = refreshPanels;

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
                model: 'openai/gpt-oss-20b',
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
      if (!navigator.onLine) throw new Error('offline');
      const result = await window.dvsc.speak(text);
      if (result.success && result.audioData) {
        playAudioBase64(result.audioData);
        return;
      }
      throw new Error('no audio');
    } catch (err) {
      speakOffline(text);
    }
  }

  // Offline fallback: Windows' built-in voices (no internet needed)
  function speakOffline(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const clean = String(text).replace(/[*_`#]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
      const u = new SpeechSynthesisUtterance(clean);
      const voices = window.speechSynthesis.getVoices();
      u.voice = voices.find(v => /hi-IN|en-IN/i.test(v.lang)) || voices.find(v => /female|zira|heera/i.test(v.name)) || null;
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.error('Offline TTS failed:', e);
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

  // Offline class alerts from the timetable
  if (window.dvsc.onClassAlert) {
    window.dvsc.onClassAlert((a) => {
      const to12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
      const venue = [a.block, a.room ? `Room ${a.room}` : ''].filter(Boolean).join(', ');
      addMessage(`📚 Vivek, **${a.title}** class ${a.minutesLeft} minute mein hai!\n🕒 ${to12(a.startTime)} – ${to12(a.endTime)}${venue ? `\n📍 ${venue}` : ''}`, 'assistant');
      speak(`Vivek, ${a.minutesLeft} minute mein ${a.title} class hai, ${to12(a.startTime)} baje${venue ? `, ${venue} mein` : ''}.`);
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

  let editingTtId = null;
  let lastTimetable = [];
  const ttFields = {
    day: () => document.getElementById('tt-day'),
    category: () => document.getElementById('tt-category'),
    startTime: () => document.getElementById('tt-start'),
    endTime: () => document.getElementById('tt-end'),
    title: () => document.getElementById('tt-title'),
    block: () => document.getElementById('tt-block'),
    room: () => document.getElementById('tt-room'),
  };

  function resetTimetableForm() {
    editingTtId = null;
    ttFields.title().value = '';
    ttFields.startTime().value = '';
    ttFields.endTime().value = '';
    ttFields.block().value = '';
    ttFields.room().value = '';
    document.getElementById('tt-form-title').textContent = '🌸 New Timetable Entry';
    saveTtBtn.textContent = 'Save Entry';
    document.querySelectorAll('.tt-entry.editing').forEach(el => el.classList.remove('editing'));
  }

  function openTimetableEditor(entry) {
    editingTtId = entry.id;
    ttFields.day().value = entry.day;
    ttFields.category().value = entry.category || 'other';
    ttFields.startTime().value = entry.startTime;
    ttFields.endTime().value = entry.endTime;
    ttFields.title().value = entry.title;
    ttFields.block().value = entry.block || '';
    ttFields.room().value = entry.room || '';
    document.getElementById('tt-form-title').textContent = '✏️ Edit Timetable Entry';
    saveTtBtn.textContent = 'Update Entry';
    timetableForm.style.display = 'block';
    timetableForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    ttFields.title().focus();
  }

  addTimetableBtn.addEventListener('click', () => {
    resetTimetableForm();
    timetableForm.style.display = 'block';
  });

  cancelTtBtn.addEventListener('click', () => {
    timetableForm.style.display = 'none';
    resetTimetableForm();
  });

  saveTtBtn.addEventListener('click', async () => {
    const entry = {
      day: ttFields.day().value,
      category: ttFields.category().value,
      startTime: ttFields.startTime().value,
      endTime: ttFields.endTime().value,
      title: ttFields.title().value.trim(),
      block: ttFields.block().value.trim(),
      room: ttFields.room().value.trim(),
    };

    if (!entry.title || !entry.startTime || !entry.endTime) {
      window.dvsc.notify("Error", "Title, Start time, and End time are required.");
      return;
    }
    if (entry.endTime <= entry.startTime) {
      window.dvsc.notify("Error", "End time must be after start time.");
      return;
    }

    if (editingTtId) {
      await window.dvsc.updateTimetableEntry(editingTtId, entry);
    } else {
      await window.dvsc.addTimetableEntry(entry);
    }

    timetableForm.style.display = 'none';
    resetTimetableForm();
    loadTimetable();
  });

  // ── Put timetable on phone (.ics calendar export) ──
  const phoneCalPanel = document.getElementById('phone-cal-panel');
  const phoneCalStatus = document.getElementById('phone-cal-status');
  document.getElementById('phone-cal-btn').addEventListener('click', () => {
    phoneCalPanel.style.display = phoneCalPanel.style.display === 'none' ? 'block' : 'none';
    document.getElementById('phone-cal-minutes').value = settings.classAlertMinutes || 15;
    phoneCalStatus.textContent = '';
  });
  document.getElementById('phone-cal-close').addEventListener('click', () => {
    phoneCalPanel.style.display = 'none';
  });
  async function exportPhoneCalendar(sendToWhatsApp) {
    const opts = {
      minutesBefore: parseInt(document.getElementById('phone-cal-minutes').value, 10) || 15,
      until: document.getElementById('phone-cal-until').value || '',
      sendToWhatsApp,
    };
    phoneCalStatus.textContent = sendToWhatsApp ? 'Sending to your WhatsApp...' : 'Creating file...';
    try {
      const res = await window.dvsc.exportTimetableICS(opts);
      if (res.canceled) { phoneCalStatus.textContent = ''; return; }
      if (!res.success) { phoneCalStatus.textContent = '⚠️ ' + res.error; return; }
      phoneCalStatus.textContent = res.sentToWhatsApp
        ? `✅ Sent ${res.count} classes to your own WhatsApp chat. Open it on your phone and tap the file.`
        : `✅ Saved ${res.count} classes to ${res.filePath}. Follow the steps below to add it to your phone.`;
    } catch (err) {
      phoneCalStatus.textContent = '⚠️ ' + (err.message || err) + ' — if this says "No handler", restart SENJU (Settings → Restart App).';
    }
  }
  document.getElementById('phone-cal-save').addEventListener('click', () => exportPhoneCalendar(false));
  document.getElementById('phone-cal-wa').addEventListener('click', () => exportPhoneCalendar(true));

  async function loadTimetable() {
    const entries = await window.dvsc.getTimetable();
    lastTimetable = entries;
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
            <div class="tt-time">${e.startTime} - ${e.endTime}${e.code ? ` · ${escapeHTML(e.code)}` : ''}</div>
            <div class="tt-title">${escapeHTML(e.title)}</div>
            ${e.faculty ? `<div class="tt-faculty">👤 ${escapeHTML(e.faculty)}</div>` : ''}
            ${(e.block || e.room) ? `<div class="tt-venue">📍 ${escapeHTML([e.block, e.room ? 'Room ' + e.room : ''].filter(Boolean).join(' · '))}</div>` : ''}
            <div class="tt-actions">
              <button class="tt-edit" data-id="${e.id}">Edit</button>
              <button class="tt-delete" data-id="${e.id}">Delete</button>
            </div>
          </div>
        `;
      });
      
      html += `</div>`;
      col.innerHTML = html;
      timetableGrid.appendChild(col);
    });

    // Edit listeners
    document.querySelectorAll('.tt-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.tt-edit').getAttribute('data-id');
        const entry = lastTimetable.find(x => x.id === id);
        if (!entry) return;
        document.querySelectorAll('.tt-entry.editing').forEach(el => el.classList.remove('editing'));
        e.target.closest('.tt-entry').classList.add('editing');
        openTimetableEditor(entry);
      });
    });

    // Delete listeners
    document.querySelectorAll('.tt-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const targetBtn = e.target.closest('.tt-delete');
        if (!targetBtn) return;
        const id = targetBtn.getAttribute('data-id');
        if (!confirm('Delete this timetable entry?')) return;
        if (editingTtId === id) {
          timetableForm.style.display = 'none';
          resetTimetableForm();
        }
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
    document.getElementById('settings-class-alerts').checked = settings.classAlertsEnabled !== false;
    document.getElementById('settings-class-alert-minutes').value = settings.classAlertMinutes || 15;
    const rk = document.getElementById('settings-rapidapi');
    if (rk) rk.value = settings.rapidApiKey || '';
  }

  const toggleRapidBtn = document.getElementById('toggle-rapidapi');
  if (toggleRapidBtn) {
    toggleRapidBtn.addEventListener('click', () => {
      const el = document.getElementById('settings-rapidapi');
      el.type = el.type === 'password' ? 'text' : 'password';
      toggleRapidBtn.textContent = el.type === 'password' ? 'Show' : 'Hide';
    });
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
      apiKey: settingsApikey.value.trim(),
            voiceEnabled: settingsVoice.checked,
      locationEnabled: settingsLocation.checked,
      classAlertsEnabled: document.getElementById('settings-class-alerts').checked,
      classAlertMinutes: Math.min(120, Math.max(1, parseInt(document.getElementById('settings-class-alert-minutes').value, 10) || 15)),
      rapidApiKey: (document.getElementById('settings-rapidapi') || {}).value ? document.getElementById('settings-rapidapi').value.trim() : '',
    };
    
    await window.dvsc.saveSettings(newSettings);
    settings = newSettings;
    
    if (settings.locationEnabled) {
      requestPreciseLocation();
    }
    loadTravel();
    
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
  // ─────────────────────────────────────────────────────────────
  // Attendance Tracker
  // ─────────────────────────────────────────────────────────────
  const attTargetInput = document.getElementById('att-target');
  const attPendingCard = document.getElementById('att-pending-card');
  const attPendingList = document.getElementById('att-pending-list');
  const attSubjectWrap = document.getElementById('att-subject-list-wrap');
  const attRecent = document.getElementById('att-recent');
  const attManualForm = document.getElementById('att-manual-form');
  const attTrashCard = document.getElementById('att-trash-card');
  const attTrashList = document.getElementById('att-trash-list');
  const attSubjectDatalist = document.getElementById('att-subject-list');
  let attendanceData = null;

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const prettyDate = (dk) => {
    if (dk === todayKey()) return 'today';
    const d = new Date(dk + 'T12:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  async function loadAttendance() {
    attendanceData = await window.dvsc.getAttendance();
    attTargetInput.value = attendanceData.target;

    // subject suggestions (shared with the exam form)
    attSubjectDatalist.innerHTML = attendanceData.subjects.map((x) => `<option value="${escapeHTML(x.subject)}">`).join('');

    // pending
    const pending = attendanceData.pending || [];
    const fromLine = attendanceData.trackFrom
      ? `Counting classes from <b>${prettyDate(attendanceData.trackFrom)}</b> — everything before that is in the portal totals. <button class="att-btn" id="att-change-from">Change</button>`
      : `Counting every class in the timetable. <button class="att-btn" id="att-change-from">Start from a date</button>`;
    attPendingCard.style.display = pending.length ? 'block' : 'none';
    attPendingList.innerHTML = pending.map((p) => `
      <div class="att-row">
        <div>
          <div class="att-name">${escapeHTML(p.subject)}</div>
          <div class="att-meta">${prettyDate(p.date)} · ${p.startTime}–${p.endTime}${p.room ? ' · Room ' + escapeHTML(p.room) : ''}</div>
        </div>
        <div class="att-actions">
          <button class="att-btn present" data-mark="present" data-subject="${escapeHTML(p.subject)}" data-date="${p.date}" data-start="${p.startTime}" data-entry="${p.entryId}">✅ Present</button>
          <button class="att-btn absent" data-mark="absent" data-subject="${escapeHTML(p.subject)}" data-date="${p.date}" data-start="${p.startTime}" data-entry="${p.entryId}">❌ Absent</button>
          <button class="att-btn cancel" data-mark="cancelled" data-subject="${escapeHTML(p.subject)}" data-date="${p.date}" data-start="${p.startTime}" data-entry="${p.entryId}">🚫 Cancelled</button>
        </div>
      </div>`).join('') + `<div class="att-advice" style="margin-top:8px;">${fromLine}</div>`;

    // subjects
    const subs = attendanceData.subjects || [];
    attSubjectWrap.innerHTML = subs.length ? subs.map((s) => `
      <div class="att-row">
        <div class="att-name">${escapeHTML(s.subject)}</div>
        <div class="att-bar att-${s.level}"><span style="width:${s.pct == null ? 0 : Math.min(100, s.pct)}%"></span></div>
        <div class="att-pct">${s.pct == null ? '—' : s.pct + '%'}</div>
        <div class="att-meta">${s.present}/${s.total}${s.cancelled ? ` (+${s.cancelled} cancelled)` : ''}</div>
        <div class="att-actions">
          <button class="att-btn" data-edit-base="${escapeHTML(s.subject)}" data-held="${s.baseline ? s.baseline.held : 0}" data-attended="${s.baseline ? s.baseline.attended : 0}">Edit portal total</button>
          <button class="att-btn" data-ignore="${escapeHTML(s.subject)}">Don't track</button>
        </div>
        <div class="att-advice">${s.code ? escapeHTML(s.code) + ' · ' : ''}portal ${s.baseline ? s.baseline.attended + '/' + s.baseline.held : '0/0'}${s.marked && (s.marked.present || s.marked.absent) ? ` + marked here ${s.marked.present}✅ ${s.marked.absent}❌` : ''}</div>
        <div class="att-advice ${s.level}">${escapeHTML(s.advice)}</div>
      </div>`).join('') + (attendanceData.overallPct != null
        ? `<div class="att-advice" style="margin-top:10px;">Overall: <b>${attendanceData.overallPct}%</b> across all subjects</div>` : '')
      : '<div class="empty-hint">Add classes in the Timetable tab — SENJU will ask after each one.</div>';

    if (attendanceData.ignored && attendanceData.ignored.length) {
      attSubjectWrap.innerHTML += `<div class="att-advice" style="margin-top:8px;">Not tracked: ${attendanceData.ignored.map(escapeHTML).join(', ')} ${attendanceData.ignored.map((n) => `<button class="att-btn" data-ignore="${escapeHTML(n)}">undo</button>`).join(' ')}</div>`;
    }

    // recent
    const recent = attendanceData.recent || [];
    if (!pending.length) attSubjectWrap.innerHTML += `<div class="att-advice" style="margin-top:8px;">${fromLine}</div>`;

    attRecent.innerHTML = (recent.length ? recent.map((r) => `
      <div class="att-row">
        <div class="att-name">${escapeHTML(r.subject)}</div>
        <div class="att-meta">${prettyDate(r.date)}${r.startTime ? ' · ' + r.startTime : ''}</div>
        <div class="att-meta">${r.status === 'present' ? '✅ Present' : r.status === 'absent' ? '❌ Absent' : '🚫 Cancelled'}</div>
        <div class="att-actions"><button class="att-btn absent" data-del-att="${r.id}">Delete</button></div>
      </div>`).join('')
      : '<div class="empty-hint">Nothing marked here yet. Portal totals are kept separately above.</div>')
      + '<div class="empty-hint">Deleting a row here only removes that one class — your imported portal totals never change.</div>';

    // recently deleted → undo
    const trash = attendanceData.trash || [];
    attTrashCard.style.display = trash.length ? 'block' : 'none';
    attTrashList.innerHTML = trash.map((r) => `
      <div class="att-row">
        <div class="att-name">${escapeHTML(r.subject)}</div>
        <div class="att-meta">${prettyDate(r.date)}${r.startTime ? ' · ' + r.startTime : ''} · ${r.status}</div>
        <div class="att-actions"><button class="att-btn present" data-restore-att="${r.id}">↩ Undo</button></div>
      </div>`).join('');
  }

  async function markAttendance(payload) {
    const res = await window.dvsc.markAttendance(payload);
    if (res && res.success === false) {
      window.dvsc.notify('Attendance', res.error);
      return;
    }
    await loadAttendance();
    const st = res.stats;
    if (st && st.pct != null && (st.level === 'danger' || st.level === 'warning')) {
      const msg = `⚠️ ${st.subject} attendance ${st.pct}% — ${st.advice}`;
      addMessage(msg, 'assistant');
      speak(`${st.subject} attendance ${st.pct} percent hai Vivek. ${st.advice}`);
    }
  }

  document.getElementById('view-attendance').addEventListener('click', async (e) => {
    const markBtn = e.target.closest('[data-mark]');
    if (markBtn) {
      await markAttendance({
        subject: markBtn.getAttribute('data-subject'),
        status: markBtn.getAttribute('data-mark'),
        date: markBtn.getAttribute('data-date'),
        startTime: markBtn.getAttribute('data-start'),
        entryId: markBtn.getAttribute('data-entry'),
      });
      return;
    }
    const delBtn = e.target.closest('[data-del-att]');
    if (delBtn) {
      await window.dvsc.deleteAttendanceRecord(delBtn.getAttribute('data-del-att'));
      loadAttendance();
      return;
    }
    const restoreBtn = e.target.closest('[data-restore-att]');
    if (restoreBtn) {
      await window.dvsc.restoreAttendanceRecord(restoreBtn.getAttribute('data-restore-att'));
      loadAttendance();
      return;
    }
    if (e.target.closest('#att-restore-all')) {
      await window.dvsc.restoreAllAttendance();
      loadAttendance();
      return;
    }
    if (e.target.closest('#att-clear-trash')) {
      if (!confirm('Forget these deleted marks for good?')) return;
      await window.dvsc.clearAttendanceTrash();
      loadAttendance();
      return;
    }
    if (e.target.closest('#att-change-from')) {
      const current = attendanceData.trackFrom || todayKey();
      const val = prompt('Count classes from which date? (YYYY-MM-DD)\nEverything before it stays with the portal totals.', current);
      if (val === null) return;
      await window.dvsc.setAttendanceTrackFrom(val.trim());
      loadAttendance();
      return;
    }
    const baseBtn = e.target.closest('[data-edit-base]');
    if (baseBtn) {
      const subject = baseBtn.getAttribute('data-edit-base');
      const held = prompt(`${subject}\n\nClasses HELD as per the portal:`, baseBtn.getAttribute('data-held'));
      if (held === null) return;
      const attended = prompt(`${subject}\n\nClasses ATTENDED as per the portal:`, baseBtn.getAttribute('data-attended'));
      if (attended === null) return;
      const res = await window.dvsc.setAttendanceBaseline(subject, { held, attended });
      if (res && res.success === false) window.dvsc.notify('Attendance', res.error);
      loadAttendance();
      return;
    }
    const ignoreBtn = e.target.closest('[data-ignore]');
    if (ignoreBtn) {
      await window.dvsc.toggleAttendanceIgnore(ignoreBtn.getAttribute('data-ignore'));
      loadAttendance();
    }
  });

  attTargetInput.addEventListener('change', async () => {
    await window.dvsc.setAttendanceTarget(attTargetInput.value);
    loadAttendance();
  });

  document.getElementById('att-mark-past').addEventListener('click', () => {
    attManualForm.style.display = attManualForm.style.display === 'none' ? 'block' : 'none';
    document.getElementById('att-m-date').value = todayKey();
  });
  document.getElementById('att-m-cancel').addEventListener('click', () => { attManualForm.style.display = 'none'; });
  document.getElementById('att-m-save').addEventListener('click', async () => {
    const subject = document.getElementById('att-m-subject').value.trim();
    if (!subject) return window.dvsc.notify('Attendance', 'Subject is required.');
    await markAttendance({
      subject,
      date: document.getElementById('att-m-date').value || todayKey(),
      status: document.getElementById('att-m-status').value,
    });
    attManualForm.style.display = 'none';
    document.getElementById('att-m-subject').value = '';
  });

  // "Did you attend?" prompt after a class ends
  if (window.dvsc.onAttendancePrompt) {
    window.dvsc.onAttendancePrompt((p) => {
      loadAttendance();
      const pct = p.stats && p.stats.pct != null ? ` (abhi ${p.stats.pct}%)` : '';
      addMessage(`📋 Vivek, **${p.subject}** class attend ki?${pct}\nAttendance tab mein mark kar do — ✅ / ❌ / 🚫`, 'assistant');
      speak(`Vivek, ${p.subject} class attend ki?`);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Exams & Study Planner
  // ─────────────────────────────────────────────────────────────
  const examForm = document.getElementById('exam-form');
  const examSettings = document.getElementById('exam-settings');
  const examCards = document.getElementById('exam-cards');
  const studyToday = document.getElementById('study-today');
  const studyWeek = document.getElementById('study-week');
  let editingExamId = null;
  let examsData = null;

  function examFields() {
    return {
      subject: document.getElementById('exam-subject'),
      date: document.getElementById('exam-date'),
      time: document.getElementById('exam-time'),
      difficulty: document.getElementById('exam-difficulty'),
      topics: document.getElementById('exam-topics'),
    };
  }

  function resetExamForm() {
    editingExamId = null;
    const f = examFields();
    f.subject.value = ''; f.date.value = ''; f.time.value = ''; f.difficulty.value = '2'; f.topics.value = '';
    document.getElementById('exam-form-title').textContent = '📝 New Exam';
    document.getElementById('exam-save').textContent = 'Save Exam';
  }

  function sessionRow(s, withDate) {
    return `
      <div class="study-row ${s.done ? 'done' : ''}">
        <input type="checkbox" data-session="${s.id}" ${s.done ? 'checked' : ''}>
        <div class="study-time">${withDate ? prettyDate(s.date) + ' ' : ''}${s.start}–${s.end}</div>
        <div class="study-text">${escapeHTML(s.subject)}<small>${escapeHTML(s.topic)}</small></div>
      </div>`;
  }

  async function loadExams() {
    examsData = await window.dvsc.getExams();
    const cfg = examsData.settings || {};
    document.getElementById('study-day-start').value = cfg.dayStart || '07:00';
    document.getElementById('study-day-end').value = cfg.dayEnd || '22:00';
    document.getElementById('study-session-min').value = cfg.sessionMinutes || 60;
    document.getElementById('study-max-day').value = cfg.maxSessionsPerDay || 3;
    document.getElementById('study-reminder-time').value = cfg.reminderTime || '08:00';

    examCards.innerHTML = (examsData.exams || []).map((e) => `
      <div class="exam-card ${e.daysLeft >= 0 && e.daysLeft <= 3 ? 'soon' : ''}">
        <h4>${escapeHTML(e.subject)}</h4>
        <div class="exam-days">${e.daysLeft < 0 ? '—' : e.daysLeft}<small> ${e.daysLeft < 0 ? 'over' : e.daysLeft === 1 ? 'DAY LEFT' : 'DAYS LEFT'}</small></div>
        <div class="exam-meta">${prettyDate(e.date)}${e.time ? ' · ' + e.time : ''} · ${['Easy', 'Normal', 'Hard'][e.difficulty - 1]}</div>
        ${e.topics.length ? `<div class="exam-topics">${escapeHTML(e.topics.slice(0, 5).join(' · '))}${e.topics.length > 5 ? ` +${e.topics.length - 5}` : ''}</div>` : ''}
        <div class="exam-progress"><span style="width:${e.progress}%"></span></div>
        <div class="exam-meta">${e.sessionsDone}/${e.sessionsPlanned} study sessions done</div>
        <div class="exam-card-actions">
          <button class="att-btn" data-edit-exam="${e.id}">Edit</button>
          <button class="att-btn absent" data-del-exam="${e.id}">Delete</button>
        </div>
      </div>`).join('') || '<div class="empty-hint">No exams yet. Add one and SENJU will build a study plan in your free slots.</div>';

    studyToday.innerHTML = (examsData.today || []).length
      ? examsData.today.map((s) => sessionRow(s, false)).join('')
      : '<div class="empty-hint">Nothing planned for today.</div>';

    const byDay = {};
    for (const s of examsData.next7 || []) (byDay[s.date] = byDay[s.date] || []).push(s);
    const days = Object.keys(byDay).sort();
    studyWeek.innerHTML = days.length
      ? days.map((d) => `<div class="study-day-head">${new Date(d + 'T12:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</div>` +
          byDay[d].map((s) => sessionRow(s, false)).join('')).join('')
      : '<div class="empty-hint">No sessions in the next 7 days.</div>';
  }

  document.getElementById('exam-add-btn').addEventListener('click', () => {
    resetExamForm();
    examForm.style.display = 'block';
  });
  document.getElementById('exam-cancel').addEventListener('click', () => {
    examForm.style.display = 'none';
    resetExamForm();
  });
  document.getElementById('exam-settings-btn').addEventListener('click', () => {
    examSettings.style.display = examSettings.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('exam-replan-btn').addEventListener('click', async () => {
    await window.dvsc.regenerateStudyPlan();
    loadExams();
    window.dvsc.notify('SENJU', 'Study plan rebuilt.');
  });
  document.getElementById('study-settings-save').addEventListener('click', async () => {
    await window.dvsc.saveStudySettings({
      dayStart: document.getElementById('study-day-start').value || '07:00',
      dayEnd: document.getElementById('study-day-end').value || '22:00',
      sessionMinutes: parseInt(document.getElementById('study-session-min').value, 10) || 60,
      maxSessionsPerDay: parseInt(document.getElementById('study-max-day').value, 10) || 3,
      reminderTime: document.getElementById('study-reminder-time').value || '08:00',
    });
    examSettings.style.display = 'none';
    loadExams();
  });

  document.getElementById('exam-save').addEventListener('click', async () => {
    const f = examFields();
    const payload = {
      subject: f.subject.value.trim(),
      date: f.date.value,
      time: f.time.value,
      difficulty: parseInt(f.difficulty.value, 10) || 2,
      topics: f.topics.value.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean),
    };
    if (!payload.subject || !payload.date) {
      window.dvsc.notify('Exam', 'Subject and date are required.');
      return;
    }
    if (editingExamId) await window.dvsc.updateExam(editingExamId, payload);
    else {
      const res = await window.dvsc.addExam(payload);
      if (res && res.success === false) return window.dvsc.notify('Exam', res.error);
    }
    examForm.style.display = 'none';
    resetExamForm();
    loadExams();
  });

  document.getElementById('view-exams').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit-exam]');
    if (edit) {
      const ex = (examsData.exams || []).find((x) => x.id === edit.getAttribute('data-edit-exam'));
      if (!ex) return;
      editingExamId = ex.id;
      const f = examFields();
      f.subject.value = ex.subject; f.date.value = ex.date; f.time.value = ex.time || '';
      f.difficulty.value = String(ex.difficulty); f.topics.value = (ex.topics || []).join('\n');
      document.getElementById('exam-form-title').textContent = '✏️ Edit Exam';
      document.getElementById('exam-save').textContent = 'Update Exam';
      examForm.style.display = 'block';
      examForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const del = e.target.closest('[data-del-exam]');
    if (del) {
      if (!confirm('Delete this exam and its study sessions?')) return;
      await window.dvsc.deleteExam(del.getAttribute('data-del-exam'));
      loadExams();
    }
  });

  document.getElementById('view-exams').addEventListener('change', async (e) => {
    const box = e.target.closest('[data-session]');
    if (!box) return;
    await window.dvsc.setStudySessionDone(box.getAttribute('data-session'), box.checked);
    loadExams();
  });

  if (window.dvsc.onStudyReminder) {
    window.dvsc.onStudyReminder((r) => {
      loadExams();
      if (r.type === 'morning') {
        const lines = (r.sessions || []).map((s) => `• ${s.start} ${s.subject} — ${s.topic}`);
        const text = [`📚 Aaj ka study plan${r.examLine ? ` (${r.examLine})` : ''}:`, ...lines].join('\n');
        addMessage(text, 'assistant');
        speak(`Vivek, aaj ka study plan ready hai. ${(r.sessions || []).map((s) => `${s.start} baje ${s.subject}`).join(', ')}`);
      } else if (r.session) {
        addMessage(`⏳ 5 minute mein study session: **${r.session.subject}** — ${r.session.topic} (${r.session.start}–${r.session.end})`, 'assistant');
        speak(`Vivek, 5 minute mein ${r.session.subject} padhna hai. ${r.session.topic}`);
      }
    });
  }

  if (window.dvsc.onAcademicsUpdated) {
    window.dvsc.onAcademicsUpdated((what) => {
      if (what === 'attendance') loadAttendance();
      if (what === 'exams') loadExams();
    });
  }

  // ===========================================================
  // Travel - train agent
  // ===========================================================
  const travelEls = {
    from: document.getElementById('travel-from'),
    to: document.getElementById('travel-to'),
    date: document.getElementById('travel-date'),
    cls: document.getElementById('travel-class'),
    sort: document.getElementById('travel-sort'),
    status: document.getElementById('travel-status'),
    summary: document.getElementById('travel-summary'),
    results: document.getElementById('travel-results'),
    sitesCard: document.getElementById('travel-sites-card'),
    sites: document.getElementById('travel-sites'),
    watches: document.getElementById('travel-watches'),
    badge: document.getElementById('travel-live-badge'),
    statusOut: document.getElementById('travel-status-out'),
  };
  let travelInfo = { liveData: false, sites: [] };
  let travelLast = null;

  function travelSetStatus(text, isError) {
    if (!travelEls.status) return;
    travelEls.status.textContent = text || '';
    travelEls.status.style.color = isError ? 'var(--danger)' : '';
  }

  async function loadTravel() {
    if (!travelEls.results || !window.dvsc.trainInfo) return;
    try {
      travelInfo = await window.dvsc.trainInfo();
      travelEls.badge.textContent = travelInfo.liveData ? 'Live availability: on' : 'Live availability: off (add RapidAPI key in Settings)';
      travelEls.badge.classList.toggle('on', !!travelInfo.liveData);
      travelEls.badge.classList.toggle('off', !travelInfo.liveData);
      if (!travelEls.date.value) { const t = new Date(Date.now() + 86400000); travelEls.date.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
      const wl = await window.dvsc.trainWatchList();
      renderTravelWatches(wl.success ? wl.data : []);
      if (!travelLast) {
        const last = await window.dvsc.trainLastSearch();
        if (last) renderTravelSearch(last);
      }
    } catch (e) {
      console.error('loadTravel failed', e);
    }
  }

  function trainAvailHtml(a) {
    if (!a) return '';
    const p = a.probability != null ? ` · ${a.probability}% confirm` : '';
    return `<div class="avail ${a.status || 'unknown'}">${escapeHTML(a.text || 'unknown')}${p}</div>`;
  }

  function renderTravelSearch(r) {
    travelLast = r;
    if (!r) return;
    travelEls.from.value = r.from.code;
    travelEls.to.value = r.to.code;
    travelEls.date.value = r.date;
    if (r.cls) travelEls.cls.value = r.cls;

    const classAvgTxt = Object.entries(r.classAvg || {}).map(([c, v]) => `${c} ₹${v.avg}`).join(' · ');
    travelEls.summary.style.display = 'grid';
    travelEls.summary.innerHTML = `
      <div class="travel-stat"><div class="k">Trains</div><div class="v">${r.count}</div><div class="s">${escapeHTML(r.from.name)} → ${escapeHTML(r.to.name)} · ${prettyDate(r.date)}</div></div>
      <div class="travel-stat"><div class="k">Cheapest${r.cls ? ' ' + r.cls : ''}</div><div class="v">${r.cheapest ? '₹' + r.cheapest.fare : '—'}</div><div class="s">${r.cheapest ? escapeHTML(r.cheapest.no + ' ' + r.cheapest.name) : ''}</div></div>
      <div class="travel-stat"><div class="k">Fastest</div><div class="v">${r.fastest ? escapeHTML(r.fastest.duration) : '—'}</div><div class="s">${r.fastest ? escapeHTML(r.fastest.no + ' ' + r.fastest.name) : ''}</div></div>
      <div class="travel-stat"><div class="k">Average fare</div><div class="v">${r.avgFare ? '₹' + r.avgFare : '—'}</div><div class="s">${r.cls ? 'for ' + r.cls : escapeHTML(classAvgTxt)}</div></div>`;

    if (!r.count) {
      travelEls.results.innerHTML = `<div class="empty-hint">No direct trains on ${prettyDate(r.date)}${r.cls ? ' with ' + r.cls : ''}. ${r.totalOnRoute ? r.totalOnRoute + ' trains run on this route on other days.' : 'Try a nearby junction.'}</div>`;
      travelEls.sitesCard.style.display = 'none';
      return;
    }

    const siteButtons = (t) => (travelInfo.sites || []).map((s) => `<button data-book="${s.id}" data-train="${t.no}">${escapeHTML(s.name)}</button>`).join('');
    travelEls.results.innerHTML = r.trains.map((t) => {
      const fares = Object.entries(t.fares).sort((a, b) => a[1] - b[1])
        .map(([c, v]) => `<span class="fare-chip ${r.cls === c ? 'sel' : ''}" title="${escapeHTML(c)}">${c} ₹${v}</span>`).join('');
      const tags = (t.tags || []).map((x) => `<span class="tag-chip ${x}">${x}</span>`).join('');
      const vs = t.vsAvgPct != null && r.cls ? `<div class="t-sub">${t.vsAvgPct > 0 ? '+' : ''}${t.vsAvgPct}% vs average</div>` : '';
      const canWatch = !!r.cls;
      return `
        <div class="train-card ${t.tags && t.tags.includes('cheapest') ? 'best' : ''}" data-no="${t.no}">
          <div>
            <div class="t-name">${t.no} ${escapeHTML(t.name)}${tags}</div>
            <div class="t-sub">${escapeHTML(t.type || '')} · ${t.distanceKm || '?'} km · runs ${escapeHTML((t.runsOn || []).join(' '))}</div>
            ${vs}
          </div>
          <div>
            <div class="t-time">${t.dep} → ${t.arr}${t.arrDayOffset ? `<small> +${t.arrDayOffset}d</small>` : ''}</div>
            <div class="t-dur">${escapeHTML(t.duration)}</div>
            ${trainAvailHtml(t.availability)}
          </div>
          <div class="t-fares">${fares || '<span class="empty-hint">fare n/a</span>'}</div>
          <div class="t-actions">
            ${travelInfo.liveData && r.cls ? `<button class="att-btn" data-avail="${t.no}">Check seats</button>` : ''}
            ${canWatch ? `<button class="att-btn present" data-watch="${t.no}" data-name="${escapeHTML(t.name)}" ${travelInfo.liveData ? '' : 'title="Needs RapidAPI key"'}>Watch seat</button>` : ''}
            <span class="book-menu"><button class="att-btn" data-book-menu="${t.no}">Book ▾</button><span class="book-list">${siteButtons(t)}</span></span>
          </div>
        </div>`;
    }).join('');

    if (r.sites) {
      travelEls.sitesCard.style.display = 'block';
      travelEls.sites.innerHTML = `<div class="empty-hint">Base fare ₹${r.sites.fare} (cheapest option). ${escapeHTML(r.sites.note)}</div>` +
        r.sites.rows.map((s, i) => `
          <div class="site-row ${i === 0 ? 'best' : ''}">
            <div><b>${escapeHTML(s.name)}</b>${s.note ? `<div class="empty-hint">${escapeHTML(s.note)}</div>` : ''}</div>
            <div>fee ₹${s.fee}</div>
            <div>payment ₹${s.pg}</div>
            <div class="total">₹${s.total}${s.extra ? `<small> (+₹${s.extra})</small>` : ''}</div>
            <div><button class="att-btn" data-book="${s.id}">Open</button></div>
          </div>`).join('');
    } else {
      travelEls.sitesCard.style.display = 'none';
    }
  }

  function renderTravelWatches(list) {
    const active = (list || []).filter((w) => w.active);
    const done = (list || []).filter((w) => !w.active);
    if (!active.length && !done.length) {
      travelEls.watches.innerHTML = '<div class="empty-hint">No watches yet. Search a train with a class and click “Watch seat” on a waitlisted option.</div>';
      return;
    }
    const row = (w) => `
      <div class="watch-row">
        <div>
          <b>${w.trainNo} ${escapeHTML(w.trainName || '')}</b> ${w.from} → ${w.to} · ${prettyDate(w.date)} · ${w.cls}
          <div class="avail ${w.lastStatus || 'unknown'}">${escapeHTML(w.lastText || 'not checked yet')}${w.probability != null ? ` · ${w.probability}% confirm` : ''}${w.lastCheckedAt ? ` · checked ${new Date(w.lastCheckedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}${w.active ? '' : ' · ended'}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="att-btn" data-book="irctc" data-wfrom="${w.from}" data-wto="${w.to}" data-wdate="${w.date}" data-wcls="${w.cls}">Book</button>
          <button class="att-btn absent" data-unwatch="${w.id}">Remove</button>
        </div>
      </div>`;
    travelEls.watches.innerHTML = active.map(row).join('') + done.slice(0, 3).map(row).join('');
  }

  async function travelDoSearch() {
    const q = {
      from: travelEls.from.value.trim(),
      to: travelEls.to.value.trim(),
      date: travelEls.date.value,
      cls: travelEls.cls.value || undefined,
      sort: travelEls.sort.value || undefined,
    };
    if (!q.from || !q.to || !q.date) return travelSetStatus('From, To aur Date bharo.', true);
    travelSetStatus('Searching…');
    const res = await window.dvsc.trainSearch(q);
    if (!res.success) return travelSetStatus(res.error, true);
    travelSetStatus(`${res.data.count} trains found${res.data.liveData && q.cls ? ' · live seats checked for top 6' : ''}`);
    renderTravelSearch(res.data);
  }

  if (travelEls.results) {
    document.getElementById('travel-search-btn').addEventListener('click', travelDoSearch);
    [travelEls.from, travelEls.to].forEach((el) => el.addEventListener('keydown', (e) => {
      const sug = document.getElementById(el.id + '-suggest');
      if (e.key === 'Enter' && !(sug && sug.classList.contains('open'))) travelDoSearch();
    }));
    document.getElementById('travel-swap-btn').addEventListener('click', () => {
      const a = travelEls.from.value; travelEls.from.value = travelEls.to.value; travelEls.to.value = a;
    });
    document.getElementById('travel-check-watches').addEventListener('click', async () => {
      travelSetStatus('Checking watches…');
      const res = await window.dvsc.trainWatchCheck();
      if (res.success) { renderTravelWatches(res.data); travelSetStatus('Watches updated.'); }
      else travelSetStatus(res.error, true);
    });

    // Station suggestions - custom dropdown (no native <datalist>: its popup can hang frameless windows)
    const stationBox = (input) => {
      const box = document.getElementById(input.id + '-suggest');
      let timer = null;
      let items = [];
      let active = -1;
      const hide = () => { box.classList.remove('open'); box.innerHTML = ''; items = []; active = -1; };
      const pick = (s) => { input.value = s.code; input.title = s.name; hide(); };
      const render = () => {
        if (!items.length) return hide();
        box.innerHTML = items.map((s, i) => `<button type="button" class="${i === active ? 'active' : ''}" data-i="${i}">${escapeHTML(s.name)}<small>${s.code}</small></button>`).join('');
        box.classList.add('open');
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) return hide();
        timer = setTimeout(async () => {
          try {
            const list = await window.dvsc.trainStations(q);
            if (input.value.trim() !== q) return; // stale
            items = (list || []).slice(0, 8);
            active = -1;
            render();
          } catch (_) { hide(); }
        }, 120);
      });
      input.addEventListener('keydown', (e) => {
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(items[active >= 0 ? active : 0]); }
        else if (e.key === 'Escape') hide();
      });
      input.addEventListener('blur', () => setTimeout(hide, 150));
      box.addEventListener('mousedown', (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        e.preventDefault();
        pick(items[parseInt(b.getAttribute('data-i'), 10)]);
      });
    };
    stationBox(travelEls.from);
    stationBox(travelEls.to);

    document.getElementById('travel-pnr-btn').addEventListener('click', async () => {
      const pnr = document.getElementById('travel-pnr').value.trim();
      travelEls.statusOut.textContent = 'Checking PNR… (10–20 seconds, hidden browser se live page padh rahi hu)';
      const res = await window.dvsc.trainPnr(pnr);
      if (!res.success) return (travelEls.statusOut.textContent = res.error);
      const p = res.data;
      if (p.invalid) return (travelEls.statusOut.textContent = `PNR ${p.pnr}: ${p.raw}`);
      const head = [p.train, p.from && p.to ? `${p.from} → ${p.to}` : '', p.date, p.cls, p.quota].filter(Boolean).join(' · ');
      const chart = p.chartPrepared == null ? '' : `\nChart: ${p.chartPrepared === true || /prepared|yes/i.test(String(p.chartPrepared)) ? 'prepared' : 'not prepared'}`;
      travelEls.statusOut.textContent = `PNR ${p.pnr}${head ? ' · ' + head : ''}\n` +
        (p.passengers.map((x) => `Passenger ${x.no}: ${x.current || x.booking}${x.booking && x.current && x.booking !== x.current ? ` (booked ${x.booking})` : ''}${x.coach ? ` · ${x.coach}${x.berth ? '/' + x.berth : ''}` : ''}${x.confirmChance ? ` · confirm chance ${x.confirmChance}` : ''}`).join('\n') || p.raw || 'No passenger rows found.') +
        chart + (p.note ? `\n${p.note}` : '') + `\nSource: ${p.source}`;
    });
    document.getElementById('travel-live-btn').addEventListener('click', async () => {
      const no = document.getElementById('travel-live-no').value.trim();
      travelEls.statusOut.textContent = 'Fetching running status… (10–20 seconds)';
      const res = await window.dvsc.trainLive(no, 0);
      if (!res.success) return (travelEls.statusOut.textContent = res.error);
      const s = res.data;
      if (!s.status && !s.currentStation && s.raw) return (travelEls.statusOut.textContent = `${s.trainNo} (${s.source})\n${s.raw}`);
      travelEls.statusOut.textContent = `${s.trainNo} ${s.trainName}${s.startDate ? ` · started ${s.startDate}` : ''}\n${s.status || 'status unknown'}${s.currentStation ? ` · at ${s.currentStation}` : ''}${s.delayMin != null ? ` · delay ${s.delayMin} min` : ''}` +
        (s.nextStation ? `\nNext: ${s.nextStation}${s.eta ? ` · ETA ${s.eta}` : ''}${s.platform ? ` · PF ${s.platform}` : ''}` : '') +
        (s.upcoming.length ? `\nUpcoming: ${s.upcoming.map((u) => `${u.name}${u.eta ? ' ' + u.eta : ''}${u.delay ? ` (${u.delay})` : ''}`).join(', ')}` : '') +
        (s.note ? `\n${s.note}` : '') + (s.lastUpdated ? `\nUpdated ${s.lastUpdated}` : '') + `\nSource: ${s.source}`;
    });

    document.getElementById('view-travel').addEventListener('click', async (e) => {
      const menuBtn = e.target.closest('[data-book-menu]');
      document.querySelectorAll('.book-menu.open').forEach((m) => { if (!m.contains(e.target)) m.classList.remove('open'); });
      if (menuBtn) { menuBtn.parentElement.classList.toggle('open'); return; }

      const book = e.target.closest('[data-book]');
      if (book) {
        const q = travelLast
          ? { from: travelLast.from.code, to: travelLast.to.code, date: travelLast.date, cls: travelLast.cls }
          : { from: travelEls.from.value, to: travelEls.to.value, date: travelEls.date.value, cls: travelEls.cls.value };
        if (book.dataset.wfrom) Object.assign(q, { from: book.dataset.wfrom, to: book.dataset.wto, date: book.dataset.wdate, cls: book.dataset.wcls });
        q.site = book.getAttribute('data-book');
        const res = await window.dvsc.trainOpenBooking(q);
        travelSetStatus(res.success ? `Opened ${res.data.site}${res.data.prefill ? ' with your search pre-filled' : ' — enter stations & date there'}. Login/OTP/payment aap khud karo.` : res.error, !res.success);
        return;
      }

      const avail = e.target.closest('[data-avail]');
      if (avail && travelLast) {
        const no = avail.getAttribute('data-avail');
        avail.textContent = '…';
        const res = await window.dvsc.trainAvailability({ trainNo: no, from: travelLast.from.code, to: travelLast.to.code, date: travelLast.date, cls: travelLast.cls });
        avail.textContent = 'Check seats';
        const t = travelLast.trains.find((x) => x.no === no);
        if (t) { t.availability = res.success ? res.data : { status: 'unknown', text: res.error }; renderTravelSearch(travelLast); }
        return;
      }

      const watch = e.target.closest('[data-watch]');
      if (watch && travelLast) {
        const res = await window.dvsc.trainWatchAdd({ trainNo: watch.getAttribute('data-watch'), trainName: watch.getAttribute('data-name'), from: travelLast.from.code, to: travelLast.to.code, date: travelLast.date, cls: travelLast.cls });
        if (!res.success) return travelSetStatus(res.error, true);
        travelSetStatus('Watching — alert aayega jab seat khulegi.');
        const wl = await window.dvsc.trainWatchList();
        if (wl.success) renderTravelWatches(wl.data);
        return;
      }

      const un = e.target.closest('[data-unwatch]');
      if (un) {
        await window.dvsc.trainWatchRemove(un.getAttribute('data-unwatch'));
        const wl = await window.dvsc.trainWatchList();
        if (wl.success) renderTravelWatches(wl.data);
      }
    });

    if (window.dvsc.onTrainSearchResult) window.dvsc.onTrainSearchResult((r) => renderTravelSearch(r));
    if (window.dvsc.onTrainWatchesUpdated) window.dvsc.onTrainWatchesUpdated((list) => renderTravelWatches(list));
    // Booking agent progress → chat + voice (login / handoff moments matter)
    if (window.dvsc.onBookingStatus) {
      let lastSpoken = '';
      window.dvsc.onBookingStatus((st) => {
        if (!st || !st.state) return;
        if (['need_user', 'handoff', 'error', 'cancelled'].includes(st.state) && st.message !== lastSpoken) {
          lastSpoken = st.message;
          addMessage(`🤖 Booking agent: ${st.message}`, 'assistant');
          speak(st.state === 'handoff' ? 'Vivek, booking review page ready hai. Captcha bhar ke payment kar lo.' : st.state === 'need_user' ? 'Vivek, IRCTC login chahiye, Chrome window dekho.' : `Booking agent: ${st.message}`);
        }
      });
    }

    if (window.dvsc.onTrainAlert) {
      window.dvsc.onTrainAlert((a) => {
        addMessage(`${a.title} ${a.body}`, 'assistant');
        speak(`Vivek, ${a.watch.trainNo} mein ${a.availability.status === 'rac' ? 'RAC' : 'seat'} available ho gayi hai, ${a.watch.date} ke liye. Jaldi book kar lo.`);
      });
    }
  }

  const waQrImg = document.getElementById('whatsapp-qr-img');
  const waStatus = document.getElementById('whatsapp-status-text');
  const waLoader = document.getElementById('whatsapp-loader');
  const waActions = document.getElementById('wa-actions');
  const waLogoutBtn = document.getElementById('whatsapp-logout-btn');
  const waReconnectBtn = document.getElementById('whatsapp-reconnect-btn');
  const waResetBtn = document.getElementById('whatsapp-reset-btn');
  const waProgress = document.getElementById('wa-progress');
  const waProgressBar = document.getElementById('wa-progress-bar');
  let waLast = { state: 'starting', message: 'Starting WhatsApp...' };
  let waStuckTimer = null;

  function renderWhatsApp(st) {
    if (st) waLast = st;
    const s = waLast.rawState || waLast.state;
    const show = (el, on, display = 'block') => { if (el) el.style.display = on ? display : 'none'; };

    if (!navigator.onLine && s !== 'ready') {
      show(waLoader, false); show(waQrImg, false); show(waProgress, false);
      show(waActions, false); show(waReconnectBtn, false); show(waResetBtn, false);
      waStatus.textContent = '⚠️ No internet — WhatsApp will reconnect automatically when you are back online';
      waStatus.style.color = 'var(--danger, #ff4444)';
      return;
    }

    const isReady = s === 'ready' || s === 'connected';
    const isQR = s === 'qr' && waLast.qr;
    const isBusy = ['idle', 'starting', 'authenticated', 'loading', 'disconnected', 'offline'].includes(s);
    const isError = s === 'error';

    show(waQrImg, isQR, 'inline-block');
    if (isQR) waQrImg.src = waLast.qr;
    show(waLoader, isBusy);
    show(waProgress, s === 'loading');
    if (s === 'loading') waProgressBar.style.width = (waLast.percent || 0) + '%';
    show(waActions, isReady);
    show(waReconnectBtn, isError || s === 'disconnected');
    show(waResetBtn, isError || isQR || s === 'loading' || s === 'authenticated', 'inline-block');

    let text = waLast.message || s;
    if (s === 'loading' && waLast.percent) text = `Loading chats... ${waLast.percent}%`;
    if (isReady) text = `✅ ${waLast.message || 'WhatsApp connected'}`;
    waStatus.textContent = text;
    waStatus.style.color = isReady ? 'var(--success, #00ff88)'
      : isError ? 'var(--danger, #ff4444)'
      : isQR ? 'var(--accent-secondary)' : 'var(--text-muted)';

    // If something looks stuck for 45s, offer the Reconnect button
    clearTimeout(waStuckTimer);
    if (isBusy) {
      waStuckTimer = setTimeout(() => show(waReconnectBtn, true, 'inline-block'), 45000);
    }
  }

  async function updateWhatsAppStateUI() {
    try {
      renderWhatsApp(await window.dvsc.getWhatsAppState());
    } catch (e) {
      renderWhatsApp({ state: 'error', message: 'WhatsApp module not loaded — restart SENJU.' });
    }
  }

  updateWhatsAppStateUI();
  // SENJU's main process waits for internet and reconnects by itself — just refresh the view
  window.addEventListener('online', () => renderWhatsApp());
  window.addEventListener('offline', () => renderWhatsApp());

  if (window.dvsc.onWhatsAppStatus) {
    window.dvsc.onWhatsAppStatus((st) => renderWhatsApp(st));
  } else {
    // Older preload: fall back to legacy events
    window.dvsc.onWhatsAppQR((qr) => renderWhatsApp({ state: 'qr', qr, message: 'Scan the QR code with WhatsApp on your phone' }));
    window.dvsc.onWhatsAppReady(() => renderWhatsApp({ state: 'ready', message: 'WhatsApp connected' }));
    window.dvsc.onWhatsAppDisconnected(() => renderWhatsApp({ state: 'disconnected', message: 'Reconnecting...' }));
  }

  waReconnectBtn.addEventListener('click', async () => {
    renderWhatsApp({ state: 'starting', message: 'Reconnecting...' });
    await window.dvsc.reconnectWhatsApp();
  });

  waResetBtn.addEventListener('click', async () => {
    if (!confirm('Remove the saved WhatsApp login and show a new QR code?')) return;
    renderWhatsApp({ state: 'starting', message: 'Clearing old login...' });
    await window.dvsc.resetWhatsAppSession();
  });

  waLogoutBtn.addEventListener('click', async () => {
    if (!confirm('Log out WhatsApp from SENJU?')) return;
    renderWhatsApp({ state: 'starting', message: 'Logging out...' });
    await window.dvsc.logoutWhatsApp();
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

  // (old Fibonacci-sphere / solar-system engine removed - scenes live in senju-scenes.js)

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

  // ─────────────────────────────────────────────────────────────
  // SCENE ENGINE (senju-scenes.js) — 11 switchable 3D visuals
  // ─────────────────────────────────────────────────────────────
  var sceneList = (window.SenjuScenes && window.SenjuScenes.list) || [];
  var sceneIdx = 0;
  try {
    var savedScene = localStorage.getItem('senjuScene');
    for (var si = 0; si < sceneList.length; si++) if (sceneList[si].id === savedScene) sceneIdx = si;
  } catch (e) {}
  var sceneData = { attendance: null, exams: null, memories: [] };
  var voiceStatusForScene = 'idle';
  var lastFrameTs = 0;
  var sceneNameFlash = 0;

  async function loadSceneData() {
    try { sceneData.attendance = await window.dvsc.getAttendance(); } catch (e) {}
    try { sceneData.exams = await window.dvsc.getExams(); } catch (e) {}
    try { if (window.dvsc.getMemories) sceneData.memories = await window.dvsc.getMemories(); } catch (e) {}
  }

  function sceneEnv(dt) {
    return {
      ctx: bgCtx, W: W, H: H, t: t, dt: dt,
      hue: currentBaseHue,
      energy: Math.max(0, Math.min(2, voiceEnergy)),
      bands: senjuFreqData,
      status: voiceStatusForScene,
      mouse: mouseCurrent,
      scale: sphereScaleCurrent,
      data: sceneData,
      hsl: hsl,
    };
  }

  function setScene(idxOrId, announce) {
    var idx = typeof idxOrId === 'number'
      ? (idxOrId + sceneList.length) % sceneList.length
      : sceneList.findIndex(function (sc) { return sc.id === idxOrId; });
    if (idx < 0 || !sceneList.length) return false;
    sceneIdx = idx;
    try { localStorage.setItem('senjuScene', sceneList[idx].id); } catch (e) {}
    try { sceneList[idx].init(sceneEnv(0.016)); } catch (e) { console.warn('[SENJU] scene init failed:', e); }
    sceneNameFlash = 2.4;
    if (announce && typeof setResponse === 'function') setResponse('Visual: ' + sceneList[idx].name);
    return true;
  }
  window.senjuSetScene = setScene;

  function drawFrame(ts) {
    if (!bgCtx) return;
    var dt = lastFrameTs ? Math.min(0.05, (ts - lastFrameTs) / 1000) : 0.016;
    lastFrameTs = ts;
    t += dt;

    mouseCurrent.x += (mouseTarget.x - mouseCurrent.x) * 0.06;
    mouseCurrent.y += (mouseTarget.y - mouseCurrent.y) * 0.06;
    sphereScaleCurrent += (sphereScaleTarget - sphereScaleCurrent) * 0.08;

    paletteLerpT += dt / paletteChangeInterval;
    if (paletteLerpT >= 1) {
      paletteLerpT = 0;
      currentPaletteIdx = nextPaletteIdx;
      nextPaletteIdx = (nextPaletteIdx + 1) % MOOD_PALETTES.length;
    }
    currentBaseHue = lerpHue(MOOD_PALETTES[currentPaletteIdx].baseHue, MOOD_PALETTES[nextPaletteIdx].baseHue, paletteLerpT);

    bgCtx.clearRect(0, 0, W, H);
    var bg = bgCtx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, lerpColor(MOOD_PALETTES[currentPaletteIdx].bgTint, MOOD_PALETTES[nextPaletteIdx].bgTint, paletteLerpT));
    bg.addColorStop(1, '#05030c');
    bgCtx.fillStyle = bg;
    bgCtx.fillRect(0, 0, W, H);

    var scene = sceneList[sceneIdx];
    if (scene) {
      try { scene.draw(sceneEnv(dt)); } catch (e) { console.warn('[SENJU] scene draw failed:', e); }
    }

    bgCtx.textAlign = 'left';
    bgCtx.font = '11px Orbitron, monospace';
    var hudAlpha = sceneNameFlash > 0 ? Math.min(1, sceneNameFlash) : 0.4;
    if (sceneNameFlash > 0) sceneNameFlash -= dt;
    bgCtx.fillStyle = hsl(currentBaseHue, 90, 75, hudAlpha);
    bgCtx.fillText('◈ ' + (scene ? scene.name.toUpperCase() : '-') + '  (' + (sceneIdx + 1) + '/' + sceneList.length + ')', 24, H - 26);
    bgCtx.fillStyle = hsl(currentBaseHue, 60, 65, hudAlpha * 0.6);
    bgCtx.fillText('◀ ▶ SWITCH · BOLO "SAKURA MODE", "GALAXY MODE"...', 24, H - 12);

    var hx = mouseCurrent.x * W, hy = mouseCurrent.y * H;
    var cursorGlow = bgCtx.createRadialGradient(hx, hy, 0, hx, hy, 40);
    cursorGlow.addColorStop(0, hsl(currentBaseHue, 100, 70, 0.12));
    cursorGlow.addColorStop(1, 'transparent');
    bgCtx.beginPath();
    bgCtx.arc(hx, hy, 40, 0, Math.PI * 2);
    bgCtx.fillStyle = cursorGlow;
    bgCtx.fill();

    animFrame = requestAnimationFrame(drawFrame);
  }

  // clicks go to the active scene (orrery planets speak their status)
  if (bgCanvas) {
    bgCanvas.addEventListener('click', function (e) {
      if (!jarvisActive) return;
      var scene = sceneList[sceneIdx];
      if (scene && scene.click) {
        var text = scene.click(e.clientX, e.clientY, sceneEnv(0.016));
        if (text) {
          setResponse(text);
          if (typeof window.speak === 'function') window.speak(text);
        }
      }
    });
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
    voiceStatusForScene = cls === 'jvoice-listening' ? 'listening'
      : cls === 'jvoice-thinking' ? 'thinking'
      : cls === 'jvoice-speaking' ? 'speaking'
      : /error/i.test(text || '') ? 'error' : 'idle';
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
  var lastReply = '';
  var busyWithAI = false;

  async function sendToAI(text) {
    if (!text || !window.dvsc || busyWithAI) return;
    busyWithAI = true;
    setResponse('...');
    setStatus('PROCESSING', 'jvoice-thinking');
    if (jvoiceTranscript) jvoiceTranscript.textContent = '"' + text + '"';

    try {
      var result = await window.dvsc.sendMessage(text);
      if (result.success) {
        var reply = String(result.response || '...')
          .replace(/\[(REMINDER|TIMETABLE|COMMAND)\][\s\S]*?\[\/\1\]/g, '').trim() || 'Ho gaya, Vivek.';
        if (typeof window.senjuRefresh === 'function') window.senjuRefresh(result.refresh);
        lastReply = reply;
        setResponse(reply);
        setStatus('SPEAKING', 'jvoice-speaking');
        speakingNow = true;                       // mic ignores SENJU's own voice
        if (typeof window.speak === 'function') await window.speak(reply);
        speakingNow = false;
        micGuardUntil = Date.now() + 400;         // ignore the tail / room echo
        setStatus('LISTENING', 'jvoice-listening');
        if (jvoiceTranscript) jvoiceTranscript.textContent = '';
      } else {
        setResponse('⚠️ ' + (result.error || 'AI error'));
        setStatus('ERROR', 'jvoice-idle');
        if (typeof window.speak === 'function') {
          speakingNow = true;
          await window.speak('Vivek, AI se jawab nahi mila.');
          speakingNow = false;
        }
        setStatus('LISTENING', 'jvoice-listening');
      }
    } catch (e) {
      setResponse('System error: ' + e.message);
      setStatus('ERROR', 'jvoice-idle');
    } finally {
      busyWithAI = false;
      speakingNow = false;
    }
  }

  // -- Voice Activity Detection (adaptive, echo-safe) --
  var vadAudioContext = null;
  var vadAnalyser = null;
  var vadMicrophone = null;
  var vadStream = null;
  var vadRecorder = null;
  var vadChunks = [];
  var isRecording = false;
  var silenceTimer = null;
  var listenLoopActive = false;
  var senjuFreqData = null;      // live FFT bands, shared with the scene engine
  var freqPollTimer = null;
  var speakingNow = false;        // true while SENJU is talking
  var micGuardUntil = 0;          // short mute window after she stops
  var noiseFloor = 8;             // learned room noise
  var loudSince = 0;              // when speech first crossed the threshold
  var recordStartedAt = 0;

  var SPEECH_START_MS = 250;      // sound must last this long to count as speech
  var SILENCE_END_MS = 1200;      // quiet for this long = you finished talking
  var MAX_UTTERANCE_MS = 20000;   // hard stop so one clip can't run forever
  var MIN_CLIP_MS = 500;          // shorter than this = noise, ignored

  async function initSpeechRecognition() {
    listenLoopActive = true;
    try {
      vadStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      vadAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (vadAudioContext.state === 'suspended') await vadAudioContext.resume();
      vadAnalyser = vadAudioContext.createAnalyser();
      vadMicrophone = vadAudioContext.createMediaStreamSource(vadStream);
      vadMicrophone.connect(vadAnalyser);
      vadAnalyser.fftSize = 512;
      senjuFreqData = new Uint8Array(vadAnalyser.frequencyBinCount);
      if (freqPollTimer) clearInterval(freqPollTimer);
      freqPollTimer = setInterval(function () {
        if (listenLoopActive && vadAnalyser) { try { vadAnalyser.getByteFrequencyData(senjuFreqData); } catch (e) {} }
      }, 50);
      vadAnalyser.smoothingTimeConstant = 0.6;
      var bufferLength = vadAnalyser.frequencyBinCount;
      var dataArray = new Uint8Array(bufferLength);

      vadRecorder = new MediaRecorder(vadStream);
      vadRecorder.ondataavailable = function (e) { if (e.data.size > 0) vadChunks.push(e.data); };
      vadRecorder.onstop = async function () {
        var lengthMs = Date.now() - recordStartedAt;
        var chunks = vadChunks;
        vadChunks = [];
        if (listenLoopActive && chunks.length && lengthMs >= MIN_CLIP_MS) {
          await processAudioChunk(new Blob(chunks, { type: 'audio/webm' }));
        }
        if (listenLoopActive) requestAnimationFrame(checkAudioLevel);
      };

      setStatus('LISTENING', 'jvoice-listening');
      requestAnimationFrame(checkAudioLevel);

      function checkAudioLevel() {
        if (!listenLoopActive) return;
        vadAnalyser.getByteFrequencyData(dataArray);
        var sum = 0;
        for (var i = 0; i < bufferLength; i++) sum += dataArray[i];
        var average = sum / bufferLength;
        voiceEnergy = average / 128.0;   // drives the waveform

        var muted = speakingNow || busyWithAI || Date.now() < micGuardUntil;
        if (muted) {
          isRecording = false;
          loudSince = 0;
          if (vadRecorder.state === 'recording') { try { vadRecorder.stop(); } catch (e) {} return; }
          return requestAnimationFrame(checkAudioLevel);
        }

        // learn the room's noise level while nobody is talking
        if (!isRecording) noiseFloor = noiseFloor * 0.95 + average * 0.05;
        var threshold = Math.max(10, noiseFloor * 1.8 + 5);

        if (average > threshold) {
          if (!isRecording) {
            if (!loudSince) loudSince = Date.now();
            if (Date.now() - loudSince >= SPEECH_START_MS) {
              isRecording = true;
              recordStartedAt = Date.now();
              vadChunks = [];
              try { vadRecorder.start(); } catch (e) {}
              setStatus('LISTENING', 'jvoice-listening');
            }
          }
          clearTimeout(silenceTimer);
          if (isRecording) {
            silenceTimer = setTimeout(stopUtterance, SILENCE_END_MS);
          }
        } else if (!isRecording) {
          loudSince = 0;
        }

        if (isRecording && Date.now() - recordStartedAt > MAX_UTTERANCE_MS) stopUtterance();
        if (!isRecording) requestAnimationFrame(checkAudioLevel);
      }

      function stopUtterance() {
        clearTimeout(silenceTimer);
        if (!isRecording) return;
        isRecording = false;
        loudSince = 0;
        setStatus('PROCESSING', 'jvoice-thinking');
        try { if (vadRecorder.state === 'recording') vadRecorder.stop(); } catch (e) {}
      }
      window.senjuStopUtterance = stopUtterance;
    } catch (err) {
      console.warn('[SENJU] VAD error:', err);
      setStatus('MIC BLOCKED', 'jvoice-idle');
      if (jvoiceLabel) jvoiceLabel.textContent = '[ MIC PERMISSION DENIED — allow the microphone in Windows settings ]';
    }
  }

  // similarity check so SENJU never answers her own voice coming back through the speakers
  function looksLikeEcho(text) {
    if (!lastReply) return false;
    var clean = function (t) { return t.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim(); };
    var a = clean(text);
    var b = clean(lastReply);
    if (!a || a.length < 6) return false;
    if (b.indexOf(a) !== -1) return true;
    var words = a.split(' ').filter(function (w) { return w.length > 3; });
    if (!words.length) return false;
    var hits = words.filter(function (w) { return b.indexOf(w) !== -1; }).length;
    return hits / words.length > 0.7;
  }

  var HALLUCINATIONS = [
    'thank you', 'thanks for watching', 'please subscribe', 'subscribe to my', 'subtitles by',
    'bye.', 'you.', 'thank you.', 'subscribe', 'watching', 'music', '. .', 'sa sa sa',
  ];

  async function processAudioChunk(blob) {
    if (!listenLoopActive || busyWithAI) return;
    if (blob.size < 4000) return;   // too small to contain speech
    try {
      var storedSettings = await window.dvsc.getSettings();
      var apiKey = storedSettings && storedSettings.apiKey;
      if (!apiKey) {
        setResponse('Groq API key missing — add it in Settings.');
        setStatus('ERROR', 'jvoice-idle');
        return;
      }

      var formData = new FormData();
      formData.append('file', new File([blob], 'voice.webm', { type: 'audio/webm' }));
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('temperature', '0');
      formData.append('prompt', 'Vivek, SENJU. Hinglish commands: chrome kholo, gana chalao, volume badhao, attendance kitni hai, aaj kya padhna hai, WhatsApp message bhejo.');

      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, 20000);
      var res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey },
        body: formData,
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!res.ok) {
        var errTxt = await res.text();
        console.warn('[SENJU] Transcription failed:', res.status, errTxt);
        setResponse(res.status === 401 ? 'API key galat hai, Vivek.' : 'Sun nahi paayi — phir se bolo.');
        setStatus('LISTENING', 'jvoice-listening');
        return;
      }

      var data = await res.json();
      var text = (data.text || '').trim();
      if (text.length < 3) { setStatus('LISTENING', 'jvoice-listening'); return; }

      var lower = text.toLowerCase();
      for (var hi = 0; hi < HALLUCINATIONS.length; hi++) {
        if (lower.indexOf(HALLUCINATIONS[hi]) !== -1 && text.length < 35) {
          console.log('[SENJU] Ignored noise transcript:', text);
          setStatus('LISTENING', 'jvoice-listening');
          return;
        }
      }
      if (looksLikeEcho(text)) {
        console.log('[SENJU] Ignored own voice echo:', text);
        setStatus('LISTENING', 'jvoice-listening');
        return;
      }

      if (jvoiceTranscript) jvoiceTranscript.textContent = text;

      // visual switching by voice ("sakura mode", "galaxy dikhao", "scene badlo")
      if (window.SenjuScenes && (/\b(mode|scene|visual)\b/.test(lower) || /dikha/.test(lower))) {
        if (/\b(next|agla|badlo|change)\b/.test(lower)) {
          setScene(sceneIdx + 1, true);
          setStatus('LISTENING', 'jvoice-listening');
          return;
        }
        var wantScene = window.SenjuScenes.match(lower);
        if (wantScene) {
          setScene(wantScene, true);
          setStatus('LISTENING', 'jvoice-listening');
          return;
        }
      }

      // quick voice commands (no AI round-trip)
      if (/\b(exit|close|band karo|bandh karo)\b.*\b(senju|jarvis|mode)\b/.test(lower) ||
          /\b(senju|jarvis)\b.*\b(exit|close|band)\b/.test(lower)) {
        closeSexyMode(); return;
      }
      if (lower.indexOf('naya chat') !== -1 || lower.indexOf('new chat') !== -1) {
        window.dvsc && window.dvsc.createNewChat();
        setResponse('Nayi baat shuru, Vivek.');
        setStatus('LISTENING', 'jvoice-listening');
        return;
      }
      if (text.length < 22 && /\b(stop|chup|quiet|ruko|shh)\b/.test(lower)) {
        if (typeof window.stopAudio === 'function') window.stopAudio();
        speakingNow = false;
        setResponse('Chup ho gayi. 🙂');
        setStatus('LISTENING', 'jvoice-listening');
        return;
      }

      await sendToAI(text);
    } catch (e) {
      if (e.name === 'AbortError') setResponse('Transcription slow — phir se bolo.');
      else console.warn('[SENJU] Transcription error:', e);
      setStatus('LISTENING', 'jvoice-listening');
    }
  }

  function stopSpeechRecognition() {
    listenLoopActive = false;
    isRecording = false;
    speakingNow = false;
    busyWithAI = false;
    loudSince = 0;
    clearTimeout(silenceTimer);
    if (vadStream) { try { vadStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} vadStream = null; }
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
    lastFrameTs = 0;

    loadSceneData().then(function () { setScene(sceneIdx, false); });
    setScene(sceneIdx, false);

    jarvisOverlay.classList.add('active');
    tickClock();
    animFrame = requestAnimationFrame(drawFrame);
    requestAnimationFrame(drawWave);

    setResponse('SENJU online. \u25C0 \u25B6 se visual badlo, ya bolo "sakura mode". Naturally baat karo.');
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
  // Space = stop SENJU talking, Esc = leave SENJU mode
  document.addEventListener('keydown', function (e) {
    if (!jarvisActive) return;
    if (e.key === 'Escape') { closeSexyMode(); return; }
    if (e.key === ']') { setScene(sceneIdx + 1, true); return; }
    if (e.key === '[') { setScene(sceneIdx - 1, true); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (typeof window.stopAudio === 'function') window.stopAudio();
      speakingNow = false;
      setStatus('LISTENING', 'jvoice-listening');
    } else if (e.key === 'ArrowRight') {
      setScene(sceneIdx + 1, true);
    } else if (e.key === 'ArrowLeft') {
      setScene(sceneIdx - 1, true);
    }
  });

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
