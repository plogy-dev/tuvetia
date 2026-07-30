// Cifrado de los business token de WhatsApp de cada clínica (whatsapp_integrations.access_token_enc,
// columna además revocada para clientes PostgREST).
//
// La implementación vive en `@/lib/crypto` — la misma que usan las credenciales de correo, así hay
// un solo lugar donde están la llave y el formato. Este archivo queda como re-export para no tocar
// los imports existentes y, sobre todo, para no cambiar NADA del comportamiento: los tokens ya
// cifrados en producción se descifran igual (misma llave, mismo AES-256-GCM, mismo formato).

export { encryptSecret as encryptToken, decryptSecret as decryptToken } from "@/lib/crypto"
