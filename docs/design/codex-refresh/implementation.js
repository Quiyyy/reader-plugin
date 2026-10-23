const modes={light:['light','light','浅色','话题 · 引用 · 连续追问'],dark:['dark','dark','深色','话题 · 引用 · 连续追问'],cream:['cream','light','暖纸与葡紫强调色','浅色对话 · 葡紫强调色'],narrow:['390','390','窄屏','390px · 底部浮窗']};
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
  const mode=button.dataset.mode,config=modes[mode];document.body.classList.toggle('narrow',mode==='narrow');document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b===button));
  for(const [index,view] of ['library','chat'].entries()){const path=`assets/implemented-${view}-${config[index]}.png`;document.getElementById(view+'-image').src=path;document.getElementById(view+'-image').alt=`C 方案${config[2]}${view==='library'?'书库':'阅读对话'}`;document.getElementById(view+'-link').href=path;}
  document.getElementById('library-caption').textContent=mode==='narrow'?'390px · 笔记排列在书籍下方':'阅读状态分组 · 最近笔记';document.getElementById('chat-caption').textContent=config[3];
}));
