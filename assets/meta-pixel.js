/* ══════════════════════════════════════════════════
   Meta Pixel（Facebook 像素）— 全站共用
   Pixel ID：1141537454976539

   每一頁的 <head> 都用同一行引用這個檔案：
     <script src="/assets/meta-pixel.js"></script>
   要換 Pixel ID 或之後要加事件，只改這一個檔案。

   目前只送 PageView，不送其他事件。
   防重複：就算某一頁不小心引用兩次，也只會初始化一次、只送一次 PageView。
   ══════════════════════════════════════════════════ */
(function () {
  if (window.__unfinishedMetaPixelInit) return;
  window.__unfinishedMetaPixelInit = true;

  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', '1141537454976539');
  fbq('track', 'PageView');
})();
