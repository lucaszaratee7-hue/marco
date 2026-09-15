const $ = selector => document.querySelector(selector);
let content, version, dirty=false;
const labels={identity:'Identidad profesional',navigation:'Navegación',hero:'Presentación principal',practice:'Especialidades',about:'Sobre mí',faq:'Preguntas frecuentes',contact:'Datos de contacto',form:'Formulario',footer:'Pie y privacidad',meta:'Título y descripción del sitio',name:'Nombre',role:'Profesión',registration:'Matrícula',initials:'Iniciales',photo:'Fotografía',photoAlt:'Descripción accesible de la fotografía',eyebrow:'Encabezado pequeño',title:'Título',description:'Descripción',primary:'Botón principal',secondary:'Enlace secundario',caption:'Frase al pie',intro:'Introducción',action:'Texto del enlace',items:'Elementos',detail:'Detalle',bio:'Perfil profesional',credentialsTitle:'Título de formación',credentials:'Diplomaturas',valuesTitle:'Título de valores',values:'Valores',question:'Pregunta',answer:'Respuesta',phone:'Teléfono',whatsapp:'WhatsApp (código de país, solo dígitos)',email:'Email',whatsappMessage:'Mensaje inicial de WhatsApp',phoneLabel:'Etiqueta de teléfono',emailLabel:'Etiqueta de email',message:'Mensaje',submit:'Botón de envío',sending:'Texto durante el envío',success:'Mensaje de éxito',error:'Mensaje de error',consent:'Autorización de contacto',note:'Nota del formulario',rights:'Derechos reservados',privacyLabel:'Enlace a privacidad',privacyTitle:'Título de privacidad',privacyText:'Texto de privacidad',close:'Cerrar',socials:'Redes sociales',label:'Texto del enlace',url:'Enlace HTTPS',cta:'Botón de consulta',menu:'Menú'};
const hiddenKeys=new Set(['address','hours','experience','mapLabel','addressLabel','hoursLabel']);
function status(message){$('#status').textContent=message;}
function markDirty(){dirty=true;status('Hay cambios sin guardar.');}
async function api(url,options={}){
  const response=await fetch(url,options);const result=await response.json();
  if(!response.ok){if(response.status===401 && url!=='/api/login') status('La sesión venció. Copiá tus cambios antes de recargar e ingresar.');throw new Error(result.error || 'No se pudo completar la operación.');}return result;
}
const send=(url,method,data)=>api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function emptyLike(value){if(typeof value==='string')return '';if(Array.isArray(value))return [];return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,emptyLike(v)]));}
function field(parent,key,value){
  const container=document.createElement('div');
  if(Array.isArray(value)){
    container.className='array-group';const title=document.createElement('h3');title.textContent=labels[key]||key;container.append(title);
    value.forEach((item,i)=>{const box=document.createElement('div');box.className='array-item';if(typeof item==='string'){box.append(field(value,i,item));}else{for(const k of Object.keys(item))box.append(field(item,k,item[k]));}
      const remove=document.createElement('button');remove.className='small-button danger';remove.textContent='Quitar elemento';remove.onclick=()=>{parent[key].splice(i,1);markDirty();drawEditor();};box.append(remove);container.append(box);});
    const add=document.createElement('button');add.className='small-button';add.textContent='Agregar elemento';add.onclick=()=>{const shapes={items:parent===content.faq?{question:'',answer:''}:{title:'',description:'',detail:''},socials:{label:'',url:''}};value.push(emptyLike(value[0]??shapes[key]??''));markDirty();drawEditor();};container.append(add);
  } else {
    const label=document.createElement('label');label.textContent=typeof key==='number'?`Elemento ${key+1}`:labels[key]||key;
    const input=document.createElement('textarea');input.value=value;input.rows=value.length>150?4:value.includes('\n')?3:2;input.maxLength=10000;
    if(key==='photo'){input.readOnly=true;const hint=document.createElement('small');hint.textContent='Usá la sección Imágenes para cambiar esta fotografía.';label.append(hint);}
    input.addEventListener('input',()=>{parent[key]=input.value;markDirty();});label.append(input);container.append(label);
  }return container;
}
function drawEditor(){
  const open=new Set([...$('#editor').children].filter(s=>s.open).map(s=>s.dataset.key));const first=!$('#editor').children.length;$('#editor').replaceChildren();
  for(const [key,group] of Object.entries(content)){
    const section=document.createElement('details');section.className='editor-section';section.dataset.key=key;section.open=open.has(key)||(first&&key==='identity');const summary=document.createElement('summary');summary.textContent=labels[key]||key;section.append(summary);
    const box=document.createElement('div');box.className='editor-fields';for(const k of Object.keys(group))if(!hiddenKeys.has(k))box.append(field(group,k,group[k]));section.append(box);$('#editor').append(section);
  }
}
async function start(){const result=await api('/api/content');content=JSON.parse(result.json);version=result.version;dirty=false;$('#login').hidden=true;$('#dashboard').hidden=false;$('#boot-status').hidden=true;status('Sin cambios pendientes.');drawEditor();}
$('#login-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await send('/api/login','POST',Object.fromEntries(new FormData(form)));form.reset();await start();}catch(e){$('#login-status').textContent=e.message;}finally{button.disabled=false;}};
$('#save').onclick=async()=>{const button=$('#save');button.disabled=true;try{const snapshot=JSON.stringify(content);const result=await send('/api/admin/content','PUT',{content:JSON.parse(snapshot),version});version=result.version;dirty=JSON.stringify(content)!==snapshot;status(dirty?'Guardado. Hay nuevos cambios pendientes.':'Cambios guardados y publicados en la landing.');}catch(e){status(e.message);}finally{button.disabled=false;}};
$('#logout').onclick=async()=>{if(dirty&&!confirm('Hay cambios sin guardar. ¿Cerrar sesión y descartarlos?'))return;try{await send('/api/admin/logout','POST',{});dirty=false;location.reload();}catch(e){status(e.message);}};
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=async()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b===button;b.setAttribute('aria-selected',String(selected));$(`#panel-${b.dataset.tab}`).hidden=!selected;});
  try{if(button.dataset.tab==='images')await images();if(button.dataset.tab==='inquiries')await inquiries();}catch(e){status(e.message);}
});
document.querySelector('.admin-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];const i=tabs.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();});
async function images(){
  const rows=[{url:'/assets/marco-zarate.jpg'},...await api('/api/admin/images')];$('#image-library').replaceChildren();
  rows.forEach((item,i)=>{const button=document.createElement('button');button.className=item.url===content.identity.photo?'selected':'';button.setAttribute('aria-pressed',String(item.url===content.identity.photo));const img=document.createElement('img');img.src=item.url;img.alt=i?'Imagen subida '+i:'Fotografía original';const text=document.createElement('span');text.textContent=item.url===content.identity.photo?'Seleccionada':'Usar esta imagen';button.append(img,text);button.onclick=async()=>{content.identity.photo=item.url;markDirty();drawEditor();await images();};$('#image-library').append(button);});
}
$('#upload').onchange=async event=>{const file=event.target.files[0];if(!file)return;event.target.disabled=true;try{if(file.size>3*1024*1024)throw new Error('La imagen supera los 3 MB.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Elegí una imagen JPG, PNG o WebP.');const decoded=await createImageBitmap(file);if(decoded.width>8000||decoded.height>8000){decoded.close();throw new Error('Usá una imagen de hasta 8000 píxeles por lado.');}decoded.close();const result=await api('/api/admin/images',{method:'POST',headers:{'Content-Type':file.type},body:file});content.identity.photo=result.url;markDirty();drawEditor();await images();status('Imagen subida y seleccionada. Guardá los cambios para publicarla.');}catch(e){status(e.message);}finally{event.target.value='';event.target.disabled=false;}};
async function inquiries(){
  const rows=await api('/api/admin/inquiries');$('#inquiries').replaceChildren();if(!rows.length){$('#inquiries').textContent='Todavía no hay consultas recibidas.';return;}
  rows.forEach(row=>{const article=document.createElement('article');article.className='inquiry';const title=document.createElement('h3');title.textContent=row.name;const date=document.createElement('small');date.textContent=new Date(row.created).toLocaleString('es-AR');const contact=document.createElement('p');contact.textContent=`${row.email} · ${row.phone}`;const message=document.createElement('p');message.textContent=row.message;const remove=document.createElement('button');remove.className='small-button danger';remove.textContent='Eliminar consulta';remove.onclick=async()=>{if(!confirm('¿Eliminar definitivamente esta consulta?'))return;try{await api(`/api/admin/inquiries/${row.id}`,{method:'DELETE'});await inquiries();status('Consulta eliminada.');}catch(e){status(e.message);}};article.append(title,date,contact,message,remove);$('#inquiries').append(article);});
}
$('#refresh-inquiries').onclick=()=>inquiries().catch(e=>status(e.message));
$('#password-form').onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));if(values.next!==values.repeat){status('Las contraseñas nuevas no coinciden.');return;}if(dirty){status('Guardá tus cambios antes de cambiar la contraseña.');return;}try{await send('/api/admin/password','POST',values);location.reload();}catch(e){status(e.message);}};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
(async()=>{try{await api('/api/admin/session');await start();}catch{ $('#boot-status').hidden=true;$('#login').hidden=false;}})();

