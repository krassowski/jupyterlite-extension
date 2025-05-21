import { INotebookContent } from '@jupyterlab/nbformat';

/**
 * Debug logger (temporary, can be removed later)
 */
function debugLog(...args: any[]): void {
  console.log('[SharingService]', ...args);
}

/**
 * Token interface from the API
 */
export interface IToken {
  token: string;
}

/**
 * UUID type for notebook IDs
 */
export type UUID = string;

/**
 * Represents the response from sharing a notebook.
 */
export interface IShareResponse {
  message: string;
  notebook: {
    id: UUID;
    readable_id: string;
    password?: string; // Optional password from API
  };
}

/**
 * Response from retrieving a notebook
 */
export interface INotebookResponse {
  id: UUID;
  domain_id: string;
  readable_id: string;
  content: INotebookContent;
}

/**
 * Validates if a string is a valid UUID
 */
export function validateUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Validation helper for objects
 */
export function hasRequiredKeys<T extends object, K extends keyof T>(
  obj: unknown,
  requiredKeys: K[]
): obj is T {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  return requiredKeys.every(key => key in obj);
}

/**
 * Validates token objects
 */
export function validateToken(data: unknown): data is IToken {
  return (
    hasRequiredKeys<IToken, keyof IToken>(data, ['token']) &&
    typeof (data as IToken).token === 'string'
  );
}

/**
 * Validates notebook content
 */
export function validateNotebookContent(data: unknown): data is INotebookContent {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const requiredKeys: (keyof INotebookContent)[] = ['cells', 'metadata', 'nbformat'];
  return requiredKeys.every(key => key in data);
}

/**
 * Validates if the provided data conforms to the IShareResponse interface.
 *
 * @param data - The data to validate.
 * @returns A boolean indicating whether the data conforms to the IShareResponse interface.
 */
function validateShareResponse(data: unknown): data is IShareResponse {
  return (
    hasRequiredKeys<IShareResponse, keyof IShareResponse>(data, ['message', 'notebook']) &&
    typeof (data as IShareResponse).message === 'string' &&
    hasRequiredKeys<IShareResponse['notebook'], keyof IShareResponse['notebook']>(
      (data as IShareResponse).notebook,
      ['id', 'readable_id']
    ) &&
    validateUUID((data as IShareResponse).notebook.id)
  );
}

/**
 * Validates if the given data conforms to the INotebookResponse interface.
 *
 * @param data - The data to be validated.
 * @returns A boolean indicating whether the data is a valid INotebookResponse.
 */
function validateNotebookResponse(data: unknown): data is INotebookResponse {
  return (
    hasRequiredKeys<INotebookResponse, keyof INotebookResponse>(data, [
      'id',
      'domain_id',
      'readable_id',
      'content'
    ]) &&
    validateUUID((data as INotebookResponse).id) &&
    typeof (data as INotebookResponse).domain_id === 'string' &&
    typeof (data as INotebookResponse).readable_id === 'string' &&
    validateNotebookContent((data as INotebookResponse).content)
  );
}

/**
 * Service for interacting with the CKHub Sharing API
 */
export class SharingService {
  /** The base URL of the API (e.g. localhost:8080/api/v1/). */
  private readonly api_url: URL;

  /** The current authentication token. */
  private _token?: IToken;

  /**
   * Retrieves the current authentication token, authenticating if necessary.
   *
   * @returns A promise that resolves to the current authentication token.
   */
  get token(): Promise<IToken> {
    return (async () => {
      if (this._token) {
        return this._token;
      }
      return await this.authenticate();
    })();
  }

  /**
   * Creates an instance of the SharingService.
   *
   * @param url - The base URL of the API (e.g. localhost:8080/api/v1/).
   */
  constructor(url: string | URL) {
    this.api_url = url instanceof URL ? url : new URL(url);
    if (!this.api_url.pathname.endsWith('/')) {
      this.api_url.pathname += '/';
    }
    debugLog('Initialized with API URL:', this.api_url.toString());
  }

  /**
   * Authenticates the user by making a POST request to the authentication endpoint.
   *
   * @returns {Promise<IToken>} A promise that resolves to an authentication token.
   * @throws {Error} If the authentication request fails or the token response is invalid.
   */
  async authenticate(): Promise<IToken> {
    const endpoint = new URL('auth/issue', this.api_url);
    debugLog('Authenticating with endpoint:', endpoint.toString());

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: await this.makeHeaders()
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Authentication failed:', response.status, response.statusText, errorText);
        throw new Error(`Authentication failed: ${response.statusText}`);
      }

      const responseData = await response.json();
      debugLog('Authentication successful, received token');

      if (!validateToken(responseData)) {
        debugLog('Invalid token response:', responseData);
        throw new Error('Invalid token response');
      }

      this._token = responseData;
      return responseData;
    } catch (error) {
      debugLog('Authentication error:', error);
      throw error;
    }
  }

  /**
   * Refreshes the current token.
   *
   * @param token - The token to be refreshed. If not provided, the current token will be used.
   * @returns A promise that resolves to the refreshed token.
   * @throws {Error} If the authentication request fails or the token response is invalid.
   */
  async refresh(token?: IToken): Promise<IToken> {
    if (!token) {
      token = await this.token;
    }

    const endpoint = new URL('auth/refresh', this.api_url);
    debugLog('Refreshing token with endpoint:', endpoint.toString());

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: await this.makeHeaders(),
        body: JSON.stringify({ token: token.token })
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Token refresh failed:', response.status, response.statusText, errorText);
        throw new Error(`Token refresh failed: ${response.statusText}`);
      }

      const refreshed = await response.json();
      debugLog('Token refresh successful');

      if (!validateToken(refreshed)) {
        debugLog('Invalid token response from refresh:', refreshed);
        throw new Error('Invalid token response from refresh');
      }

      this._token = refreshed;
      return refreshed;
    } catch (error) {
      debugLog('Token refresh error:', error);
      throw error;
    }
  }

  /**
   * Retrieves a notebook by its ID.
   *
   * @param id - The ID of the notebook to retrieve.
   * @returns A promise that resolves to the notebook response.
   * @throws {Error} If the notebook retrieval fails or if the response is invalid.
   */
  async retrieve(id: string): Promise<INotebookResponse> {
    id = id.trim();
    const endpoint = validateUUID(id)
      ? new URL(`notebooks/${id}`, this.api_url)
      : new URL(`notebooks/get-by-readable-id/${id}`, this.api_url);

    debugLog('Retrieving notebook with endpoint:', endpoint.toString());

    try {
      const token = await this.token;
      const response = await fetch(endpoint, {
        headers: await this.makeHeaders(token)
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Notebook retrieval failed:', response.status, response.statusText, errorText);
        throw new Error(`Failed to retrieve notebook: ${response.statusText}`);
      }

      const responseData = await response.json();
      debugLog('Notebook retrieved successfully');

      if (!validateNotebookResponse(responseData)) {
        debugLog('Invalid notebook response:', responseData);
        throw new Error('Invalid notebook response from API');
      }

      return responseData;
    } catch (error) {
      debugLog('Notebook retrieval error:', error);
      throw error;
    }
  }

  /**
   * Stores a notebook on the server and returns a share response with the notebook ID and metadata.
   *
   * @param notebook - The notebook content to be shared.
   * @param password - An optional password to allow editing the shared notebook later.
   * @returns A promise that resolves to the share response.
   * @throws {Error} If the notebook content is invalid or if the sharing request fails.
   */
  async share(notebook: INotebookContent, password?: string): Promise<IShareResponse> {
    if (!validateNotebookContent(notebook)) {
      debugLog('Invalid notebook content provided for sharing');
      throw new Error('Invalid notebook content');
    }

    const requestData: Record<string, any> = { notebook };
    if (password) {
      requestData.password = password;
    }

    const endpoint = new URL('notebooks', this.api_url);
    debugLog('Sharing notebook with endpoint:', endpoint.toString());
    debugLog('Request payload:', { ...requestData, notebook: '(notebook content omitted)' });

    try {
      const token = await this.token;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: await this.makeHeaders(token),
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Sharing notebook failed:', response.status, response.statusText, errorText);
        throw new Error(`Sharing notebook failed: ${response.statusText}`);
      }

      const responseData = await response.json();
      debugLog('Notebook shared successfully, response:', responseData);

      if (!validateShareResponse(responseData)) {
        debugLog('Unexpected API response:', responseData);
        throw new Error('Unexpected API response while sharing');
      }

      return responseData;
    } catch (error) {
      debugLog('Notebook sharing error:', error);
      throw error;
    }
  }

  /**
   * Updates an existing shared notebook
   * @param id - Notebook ID
   * @param notebook - Updated notebook content
   * @param password - Password if notebook is protected
   * @returns API response with updated notebook details
   */
  async update(id: string, notebook: INotebookContent, password?: string): Promise<IShareResponse> {
    if (!validateNotebookContent(notebook)) {
      debugLog('Invalid notebook content provided for update');
      throw new Error('Invalid notebook content');
    }

    const requestData: Record<string, any> = { notebook };
    if (password) {
      requestData.password = password;
    }

    const endpoint = new URL(`notebooks/${id}`, this.api_url);
    debugLog('Updating notebook with endpoint:', endpoint.toString());
    debugLog('Request payload:', { ...requestData, notebook: '(notebook content omitted)' });

    try {
      const token = await this.token;
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: await this.makeHeaders(token),
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog('Updating notebook failed:', response.status, response.statusText, errorText);
        throw new Error(`Updating notebook failed: ${response.statusText}`);
      }

      const responseData = await response.json();
      debugLog('Notebook updated successfully, response:', responseData);

      if (!validateShareResponse(responseData)) {
        debugLog('Unexpected API response:', responseData);
        throw new Error('Unexpected API response while updating');
      }

      return responseData;
    } catch (error) {
      debugLog('Notebook update error:', error);
      throw error;
    }
  }

  /**
   * Constructs a URL for retrieving a notebook by its unique identifier.
   *
   * @param id - The unique identifier (UUID) or readable ID of the notebook.
   * @returns The constructed URL for retrieving the notebook.
   */
  makeRetrieveURL(id: UUID | string): URL {
    if (!id) {
      debugLog('Missing notebook ID for URL generation');
      throw new Error('Notebook ID is required');
    }

    debugLog('Generating retrieve URL for ID:', id);
    const url = validateUUID(id)
      ? new URL(`notebooks/${id}`, this.api_url)
      : new URL(`notebooks/get-by-readable-id/${id}`, this.api_url);

    debugLog('Generated URL:', url.toString());
    return url;
  }

  /**
   * Constructs headers for HTTP requests.
   *
   * @param token - The authentication token to include in the headers.
   * @param extra - Additional headers to include.
   * @returns A promise that resolves to the constructed headers.
   */
  private async makeHeaders(token?: IToken, extra?: HeadersInit): Promise<Headers> {
    const headers = new Headers({ 'Content-Type': 'application/json' });

    if (extra) {
      Object.entries(extra).forEach(([key, value]) => {
        headers.set(key, value.toString());
      });
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token.token}`);
    }

    return headers;
  }
}
