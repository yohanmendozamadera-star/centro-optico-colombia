# Activación inicial

1. Entra a tu proyecto de Supabase.
2. Abre **SQL Editor** y crea una consulta nueva.
3. Copia todo el contenido de `schema.sql`, pégalo y pulsa **Run**.
4. Abre `index.html` usando un servidor local. No lo abras mediante doble clic porque los módulos JavaScript requieren HTTP.
5. En la pantalla de acceso escribe `yohan_mendoza@outlook.com`, crea una contraseña segura y pulsa **Crear primera cuenta**.
6. Si Supabase solicita confirmar el correo, abre el mensaje recibido y confirma la cuenta.
7. Inicia sesión. El usuario quedará asignado automáticamente como **Superadministrador**.

## Importante

- La clave incluida en `config.js` es la clave pública de Supabase. Es la única clave que puede estar en el navegador.
- Nunca agregues la clave `service_role` al proyecto.
- Si la cuenta fue creada antes de ejecutar `schema.sql`, créala nuevamente después o asígnale el perfil manualmente.
