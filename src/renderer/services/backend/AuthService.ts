import axios from "axios";
import {
	signInWithPopup,
	GoogleAuthProvider,
	onAuthStateChanged,
	signOut,
} from "firebase/auth";
import { BackendClient } from "./BackendClient";
import { FirebaseService } from "./FirebaseService";

export class AuthService {
	private backend: BackendClient;
	private tokenKey = "axon.auth.token";
	private emailKey = "axon.auth.email";
	private nameKey = "axon.auth.name";

	constructor(backend: BackendClient) {
		this.backend = backend;
		const token = this.getStoredToken();
		if (token) this.backend.setAuthToken(token);

		// Keep Authorization header in sync with Firebase auth state when configured
		const auth = FirebaseService.getAuth();
		if (auth) {
			onAuthStateChanged(auth, async (user) => {
				if (user) {
					try {
						const idToken = await user.getIdToken(true);
						localStorage.setItem(this.tokenKey, idToken);
						if (user.email) localStorage.setItem(this.emailKey, user.email);
						if (user.displayName)
							localStorage.setItem(this.nameKey, user.displayName);
						this.backend.setAuthToken(idToken);
					} catch (error) {
						console.error("Failed to get ID token:", error);
						this.logout();
					}
				} else {
					this.logout();
				}
			});
		}
	}

	getStoredToken(): string | null {
		try {
			return localStorage.getItem(this.tokenKey);
		} catch {
			return null;
		}
	}

	isAuthenticated(): boolean {
		return !!this.getStoredToken();
	}

	async getFreshToken(): Promise<string | null> {
		const auth = FirebaseService.getAuth();
		if (!auth || !auth.currentUser) {
			return this.getStoredToken();
		}

		try {
			const idToken = await auth.currentUser.getIdToken(true);
			localStorage.setItem(this.tokenKey, idToken);
			this.backend.setAuthToken(idToken);
			return idToken;
		} catch (error) {
			console.error("Failed to refresh token:", error);
			this.logout();
			return null;
		}
	}

	async loginWithFirebaseGooglePopup(): Promise<{
		email: string;
		name?: string;
		access_token?: string;
	}> {
		const auth = FirebaseService.getAuth();
		if (!auth) {
			throw new Error("Firebase is not configured");
		}
		const provider = new GoogleAuthProvider();
		const cred = await signInWithPopup(auth, provider);
		const user = cred.user;
		const idToken = await user.getIdToken();
		// Optionally hit backend to upsert user and return echo token
		const url = `${this.backend.getBaseUrl()}/auth/google`;
		const res = await axios.post(url, { id_token: idToken });
		const data = res.data as {
			access_token?: string;
			email: string;
			name?: string;
		};
		const accessToken = data?.access_token || idToken;
		try {
			localStorage.setItem(this.tokenKey, accessToken);
			if (data.email || user.email)
				localStorage.setItem(this.emailKey, data.email || user.email || "");
			if (data.name || user.displayName)
				localStorage.setItem(this.nameKey, data.name || user.displayName || "");
		} catch {}
		this.backend.setAuthToken(accessToken);
		return { ...data, access_token: accessToken };
	}

	logout() {
		try {
			localStorage.removeItem(this.tokenKey);
			localStorage.removeItem(this.emailKey);
			localStorage.removeItem(this.nameKey);
		} catch {}
		this.backend.setAuthToken(null);
		const auth = FirebaseService.getAuth();
		if (auth) {
			// Best-effort signOut; ignore errors to avoid blocking UI
			try {
				void signOut(auth);
			} catch {}
		}
	}
}
