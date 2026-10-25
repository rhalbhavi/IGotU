export const firebaseConfig = {
  apiKey: "AIzaSyBEFfOM2m2CWgm0mL3VMLVnk1ZtFuJ_Lxo",
  authDomain: "igotu-f4f80.firebaseapp.com",
  projectId: "igotu-f4f80",
  storageBucket: "igotu-f4f80.firebasestorage.app",
  messagingSenderId: "982377582319",
  appId: "1:982377582319:web:e24d14a73f2e771839951a",
  measurementId: "G-W022GWFKKR"
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.startsWith("REPLACE_WITH_") &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  !firebaseConfig.appId.startsWith("REPLACE_WITH_")
);
