# Flash Work de Mapa · v2

Arquitectura: GitHub Pages sirve la web y lee `data/places.json`. Render sólo se activa al entrar en Modo Edit y escribe los cambios nuevamente en GitHub.

## Estructura

- `index.html`: mapa público + editor.
- `config.js`: URL pública del backend Render.
- `data/places.json`: base persistente de puntos.
- `assets/fotos/`: fotos originales de Cosquín.
- `assets/uploads/`: fotos añadidas desde el editor.
- `backend/`: API Node/Express para Render.
- `render.yaml`: Blueprint opcional para crear el Web Service.

## Configuración inicial (una sola vez)

1. Subir todo el contenido de esta carpeta al repositorio que ya publica GitHub Pages.
2. Crear en GitHub un Fine-grained Personal Access Token restringido al repositorio del mapa, con `Contents: Read and write`.
3. Crear un Web Service en Render apuntando al mismo repositorio. Root Directory: `backend`. Build: `npm install`. Start: `npm start`.
4. En Render cargar las variables de entorno que figuran en `backend/.env.example`.
5. Copiar la URL `https://...onrender.com` del servicio y colocarla una sola vez en `config.js`.
6. Confirmar en GitHub Pages que la fuente de publicación sea la rama donde Render realizará los commits (normalmente `main`, carpeta `/root`).

## Uso normal

- Ver el mapa: sólo GitHub Pages; Render no participa.
- Editar: pulsar `Modo Edit`, escribir la clave y activar el editor.
- Crear: `Nuevo punto`, elegir fecha, coordenadas, texto, notas y fotos, y guardar.
- Editar: seleccionar un marcador, abrir Modo Edit y usar `Editar punto seleccionado`.
- Eliminar: disponible para puntos no protegidos. Cosquín viene con `locked: true` y no se puede borrar desde la interfaz.

## Seguridad mínima

No poner `ADMIN_KEY` ni `GITHUB_TOKEN` en `config.js`, `index.html` ni ningún archivo público. Esas dos credenciales existen únicamente como variables de entorno privadas de Render.
