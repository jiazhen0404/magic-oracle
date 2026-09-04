
(function(){
  const btn=document.querySelector('.ww-menu-toggle');
  const menu=document.querySelector('.ww-mobile-menu');
  if(!btn||!menu)return;
  function close(){document.body.classList.remove('ww-menu-open');btn.setAttribute('aria-expanded','false')}
  btn.addEventListener('click',function(){
    const open=document.body.classList.toggle('ww-menu-open');
    btn.setAttribute('aria-expanded',open?'true':'false');
  });
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
})();
