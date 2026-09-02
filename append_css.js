const fs = require('fs');
const cssToAppend = `
/* New Multi-Chat Sidebar UI */
.nav-text { font-weight: 600; letter-spacing: 0.5px; }
.new-chat-btn { margin-bottom: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); justify-content: flex-start; padding-left: 18px; }
.new-chat-btn:hover { background: rgba(255, 255, 255, 0.1); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.sidebar-recent-chats { flex: 1; display: flex; flex-direction: column; padding: 0 12px; overflow: hidden; }
.recent-chats-header { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 1px; padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; }
.recent-chats-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px; }
.recent-chats-list::-webkit-scrollbar { width: 4px; }
.recent-chats-list::-webkit-scrollbar-track { background: transparent; }
.recent-chats-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.recent-chat-item { background: transparent; border: none; color: var(--text-secondary); padding: 8px 14px; text-align: left; border-radius: 8px; cursor: pointer; font-family: 'Nunito', sans-serif; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
.recent-chat-item:hover { background: rgba(255, 110, 180, 0.05); color: var(--text-primary); }
.recent-chat-item.active { background: rgba(255, 110, 180, 0.15); color: var(--text-primary); font-weight: 600; }
.delete-chat-btn { background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; display: none; }
.recent-chat-item:hover .delete-chat-btn { display: flex; }
.delete-chat-btn:hover { background: var(--danger); color: white; }
`;
fs.appendFileSync('C:\\Data\\SEXY\\styles\\main.css', cssToAppend);
console.log('Appended successfully');
