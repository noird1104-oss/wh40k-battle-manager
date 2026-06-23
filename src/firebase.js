import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCx67OhILzTsSbaBr_4pCQ2-_-SEM_9hFs",
  authDomain: "wh40k-battle-manager.firebaseapp.com",
  projectId: "wh40k-battle-manager",
  storageBucket: "wh40k-battle-manager.firebasestorage.app",
  messagingSenderId: "86869167786",
  appId: "1:86869167786:web:e2329b35ed53dbf54e8ad3"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);