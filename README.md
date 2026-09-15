# Marco Zárate · Landing y CMS

Base ejecutable con la fotografía y el contenido del Word ya integrados. Incluye landing responsive, editor de textos, biblioteca de imágenes, consultas y administración de contraseña. Entrega de código para ejecutar localmente; no está desplegada en Internet.

## 1. Stack y arquitectura

- Frontend: HTML5, CSS y JavaScript nativo. Sin compilación ni dependencias externas.
- Backend: Node.js 24.15 o superior con servidor HTTP y API del mismo origen.
- Base de datos: SQLite mediante `node:sqlite`. Guarda contenido, imágenes, consultas, hashes de contraseña y sesiones. La API SQLite incorporada tiene estado release candidate en esta línea de Node; fijar la versión del runtime y probar actualizaciones antes de producción. Documentación: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- Autenticación: usuario `admin`, contraseña aleatoria, hash scrypt con salt, sesión opaca de ocho horas en cookie HttpOnly y SameSite=Strict. La autorización se verifica en cada endpoint privado.
- Actualización: la landing consume `GET /api/content`. Al guardar, el servidor escribe SQLite y emite un evento SSE a las páginas abiertas para recargar el contenido.

Se eligió esta arquitectura para un sitio de un profesional y un administrador: un único proceso y una base de datos respaldable, sin configurar Supabase/Firebase ni servicios de correo. No requiere un JWT almacenado en el navegador. No hay registro público de administradores.

## 2. Archivos

```text
marco-zarate/
├── package.json             Scripts y versión de Node
├── .env.example             Configuración de entorno
├── .gitignore               Excluye datos y secretos
├── server.mjs               Servidor, API, SQLite y autenticación
├── content/
│   └── initial.json         Contenido inicial obtenido del Word
├── public/
│   ├── index.html           Entrada pública
│   ├── app.js               Render, formulario y eventos en vivo
│   ├── styles.css           Diseño responsive de landing y panel
│   ├── admin.html           Estructura del panel
│   ├── admin.js             Editor, subida de fotos, consultas y acceso
│   ├── favicon.svg          Marca tipográfica MZ
│   └── assets/marco-zarate.jpg  Fotografía adjunta
├── tests/integration.test.mjs
└── data/                    Se crea al arrancar; nunca es público
    ├── site.sqlite          Datos persistentes
    └── initial-password.txt Credencial inicial; se elimina al cambiarla
```

## 3. Arrancar paso a paso

Instalá Node.js 24.15 o superior si no está disponible. En una terminal, ingresá en esta carpeta y ejecutá:

```powershell
Copy-Item .env.example .env
npm start
```

También podés ejecutar `node --env-file-if-exists=.env server.mjs`. No hace falta `npm install` porque se utilizan módulos incorporados.

Abrí `http://localhost:3000` para la landing y `http://localhost:3000/admin` para el panel. Usá exactamente ese nombre de host; se verifica contra `APP_ORIGIN`.

Si el puerto está ocupado, cambiá **PORT y APP_ORIGIN** juntos en `.env`. Para detener el servidor: Ctrl+C.

## 4. Cuenta inicial

1. Al primer arranque se crea el usuario `admin` y una contraseña aleatoria de 32 caracteres.
2. Leé `data/initial-password.txt` en el equipo del servidor. Este archivo no es accesible desde la web y contiene un secreto; no lo compartas junto con el código.
3. Ingresá en `/admin` y cambiá la contraseña desde **Seguridad**. El archivo inicial se elimina y las sesiones existentes se revocan.
4. Como alternativa, definí `ADMIN_PASSWORD` en `.env` **antes del primer arranque**, con al menos 16 caracteres. En ese caso no se crea el archivo de credenciales.

Modificar `ADMIN_PASSWORD` después de crear la cuenta no cambia su contraseña. Los cambios posteriores se hacen desde el panel. No hay recuperación por correo en esta base.

## 5. Dónde insertar el Word y la fotografía

**Ya están integrados.** La transcripción se convirtió en contenido web conciso en `content/initial.json`:

| Información | Ubicación |
| --- | --- |
| Nombre, profesión, matrícula | `identity` |
| Titular, descripción y botones | `hero` y `navigation` |
| Divorcios y sucesiones | `practice.items` |
| Perfil y diplomaturas | `about` |
| Preguntas y respuestas | `faq.items` |
| Teléfono, WhatsApp y correo | `contact` |
| Etiquetas y mensajes del formulario | `form` |
| Privacidad y redes sociales | `footer` |
| Título y descripción SEO | `meta` |

Este JSON solo se importa cuando todavía no existe contenido en la base. **Una vez arrancado, editá desde el panel:** cambiar el JSON inicial no sobrescribe los datos guardados. No borres una base existente para cambiar textos.

La fotografía original está en `public/assets/marco-zarate.jpg` y se referencia desde `identity.photo`. Para reemplazarla, usá **Imágenes → Subir imagen → Guardar cambios**. Las nuevas imágenes se guardan como bytes en SQLite y se sirven desde `/media/:id`; no dependen del nombre del archivo en tu PC. La foto original tiene 400 × 400 píxeles; una versión de mayor resolución mejoraría su nitidez en pantallas grandes.

No se muestran dirección, horarios ni años de experiencia, conforme a tu indicación. Tampoco se muestra mapa. Los campos antiguos vacíos correspondientes se conservan en el esquema interno por compatibilidad, pero no se renderizan ni se ofrecen en el editor.

El número de WhatsApp usa `5493515163213`, a partir del celular argentino informado. Verificá que ese número corresponda a la cuenta de WhatsApp del profesional antes de difundir el sitio.

Se incorporaron nombre, matrícula, diplomaturas y servicios del Word. El perfil, los encabezados y las preguntas de contacto son redacción editorial propuesta. No se inventaron años de experiencia ni credenciales adicionales. No se copiaron las afirmaciones sobre plazos, costos ni efectos jurídicos específicos del documento. Las notas editoriales del Word se trataron como contexto, no como instrucciones. El aviso de privacidad describe el funcionamiento de esta base; debe adaptarse si cambiás el tratamiento de datos.

## 6. Edición y flujo de datos

1. Ingresar al panel: `POST /api/login` verifica la contraseña y establece la cookie.
2. Abrir **Contenido**: el editor construye campos a partir del JSON y permite agregar o quitar especialidades, credenciales, valores, preguntas y redes sociales.
3. Guardar: `PUT /api/admin/content` valida el esquema y la versión. Si otra sesión guardó antes, devuelve 409 para evitar sobrescribir cambios ajenos.
4. Leer la landing: `GET /api/content` devuelve `{ json, version }`.
5. Reflejar cambios: `/api/events` emite un evento después del guardado. Las páginas públicas conectadas vuelven a consultar el contenido.

Fragmento del flujo frontend (implementado en `public/app.js`):

```js
const response = await fetch('/api/content');
const saved = await response.json();
const content = JSON.parse(saved.json);
// render(content) convierte los datos en la landing.
```

El contenido se escapa antes de insertarlo en HTML. Los textos administrativos y las consultas se muestran usando `textContent`. Los enlaces de redes sociales se validan para aceptar solo HTTPS. La imagen seleccionada debe existir en la biblioteca.

## 7. Formulario y consultas

El formulario solicita nombre, email, teléfono, mensaje y autorización para responder. `POST /api/contact` valida y guarda los datos. El panel muestra las últimas 200 consultas y permite eliminarlas. **No envía emails ni mensajes de WhatsApp automáticamente.** Los botones de WhatsApp abren una conversación para que el visitante envíe el mensaje.

El servidor limita los intentos de ingreso y de formulario por IP, incorpora un campo trampa para bots y limita el tamaño de mensajes e imágenes (3 MB). Las imágenes admitidas son JPG, PNG y WebP; se comprueba su firma. Esta base no incluye servicio antivirus, recuperación de contraseña, roles múltiples ni notificaciones por email.

## 8. Verificación

```powershell
npm test
```

Las pruebas usan una base temporal aislada y el puerto 3124. Comprueban acceso privado, origen de solicitudes, login, cookies, edición, conflictos, actualización por eventos, imágenes, validación del formulario, persistencia tras reiniciar, cambio de contraseña, revocación y eliminación de consultas. No modifican los datos reales.

## 9. Llevar a producción

Esta entrega es una base local, no un despliegue público. Para alojarla se necesita un servidor compatible con Node y disco persistente (una única instancia). No es compatible tal cual con hosting de archivos estáticos ni con Cloudflare Workers/Sites; esos entornos requieren adaptar la base y el servidor.

Configurá el dominio HTTPS en `APP_ORIGIN` y `COOKIE_SECURE=true`. Usá un proxy inverso que no almacene las respuestas API ni acumule los eventos SSE. El puerto de Node debe quedar accesible solo al proxy. Agregá limitación de tráfico en el proxy: el límite incorporado usa la IP de la conexión y todos los visitantes detrás del mismo proxy podrían compartirlo. No se confía automáticamente en `X-Forwarded-For`.

Respaldá la base con el servidor detenido para no separar la base de sus archivos WAL activos, o utilizá un respaldo consistente de SQLite. Protegé la carpeta `data` con permisos del usuario del servicio. El código no expone esa carpeta por HTTP. Conservá datos y secretos fuera del repositorio. Para más tráfico, múltiples instancias o flujos de recuperación/roles, migrá la autenticación y almacenamiento a un servicio administrado.
