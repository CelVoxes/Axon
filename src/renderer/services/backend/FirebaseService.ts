import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

type FirebaseConfig = {
	apiKey: string;
	authDomain: string;
	projectId: string;
	appId: string;
};

export class FirebaseService {
	private static app: FirebaseApp | null = null;
	private static auth: Auth | null = null;

	static isConfigured(): boolean {
		// Values are replaced at build time by DefinePlugin
		return (
			typeof process !== "undefined" &&
			typeof process.env !== "undefined" &&
			!!(process.env as any).FIREBASE_API_KEY &&
			!!(process.env as any).FIREBASE_AUTH_DOMAIN &&
			!!(process.env as any).FIREBASE_PROJECT_ID &&
			!!(process.env as any).FIREBASE_APP_ID
		);
	}

	private static getConfigFromEnv(): FirebaseConfig {
		const env = ((process as any).env || {}) as Record<string, string>;
		const config: FirebaseConfig = {
			apiKey: env.FIREBASE_API_KEY,
			authDomain: env.FIREBASE_AUTH_DOMAIN,
			projectId: env.FIREBASE_PROJECT_ID,
			appId: env.FIREBASE_APP_ID,
		} as FirebaseConfig;
		return config;
	}

	static getApp(): FirebaseApp | null {
		if (!this.isConfigured()) {
			return null;
		}
		if (this.app) return this.app;
		if (getApps().length) {
			this.app = getApps()[0]!;
		} else {
			this.app = initializeApp(this.getConfigFromEnv());
		}
		return this.app;
	}

	static getAuth(): Auth | null {
		if (!this.isConfigured()) return null;
		if (this.auth) return this.auth;
		const app = this.getApp();
		if (!app) return null;
		this.auth = getAuth(app);
		return this.auth;
	}
}
