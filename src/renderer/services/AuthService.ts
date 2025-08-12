import axios from "axios";
import { BackendClient } from "./BackendClient";

export class AuthService {
	private backend: BackendClient;
	private tokenKey = "axon.auth.token";
	private emailKey = "axon.auth.email";
	private nameKey = "axon.auth.name";

	constructor(backend: BackendClient) {
		this.backend = backend;
		const token = this.getStoredToken();
		if (token) this.backend.setAuthToken(token);
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

	async loginWithGoogleIdToken(
		idToken: string
	): Promise<{ email: string; name?: string; access_token?: string }> {
		const url = `${this.backend.getBaseUrl()}/auth/google`;
		const res = await axios.post(url, { id_token: idToken });
		const data = res.data as {
			access_token?: string;
			email: string;
			name?: string;
		};
		if (data?.access_token) {
			try {
				localStorage.setItem(this.tokenKey, data.access_token);
				if (data.email) localStorage.setItem(this.emailKey, data.email);
				if (data.name) localStorage.setItem(this.nameKey, data.name);
			} catch {}
			this.backend.setAuthToken(data.access_token);
		}
		return data;
	}

	logout() {
		try {
			localStorage.removeItem(this.tokenKey);
			localStorage.removeItem(this.emailKey);
			localStorage.removeItem(this.nameKey);
		} catch {}
		this.backend.setAuthToken(null);
	}
}
