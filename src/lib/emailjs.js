import emailjs from "@emailjs/browser";

const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;

if (!publicKey) {
}

if (!serviceId) {
}

if (!templateId) {
}

if (publicKey) {
  emailjs.init({
    publicKey,
  });
}

export async function sendApplicationNotification() {
  if (!publicKey || !serviceId || !templateId) {
    throw new Error(
      "Falta configurar EmailJS (PUBLIC_KEY, SERVICE_ID o TEMPLATE_ID)",
    );
  }

  try {
    const response = await emailjs.send(serviceId, templateId, {});

    return response;
  } catch (error) {
    throw error;
  }
}
