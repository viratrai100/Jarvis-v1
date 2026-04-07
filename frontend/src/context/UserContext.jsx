import axios from 'axios'
import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'

export const userDataContext = createContext()

const MODEL_KEY = 'jarvis_selected_model'

const API_FALLBACK = {
  type: 'general',
  language: 'english',
  steps: ['error'],
  response: 'Server busy, try again.',
  suggestion: null,
  extra: null,
}

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback

function UserContext({ children }) {
  // const serverUrl = 'http://localhost:8000'
  const serverUrl = 'https://jarvis-v1-iia7.onrender.com'

  const api = useMemo(() => axios.create({
    baseURL: serverUrl,
    withCredentials: true,
    timeout: 90000,
  }), [serverUrl])

  const [userData, setUserData] = useState(null)
  const [frontendImage, setFrontendImage] = useState(null)
  const [backendImage, setBackendImage] = useState(null)
  const [selectedImage, setSelectedImage] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)
  const [authError, setAuthError] = useState('')

  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(MODEL_KEY) || 'gemini'
  )

  const changeModel = (model) => {
    setSelectedModel(model)
    localStorage.setItem(MODEL_KEY, model)
    console.log('[Model] Switched to:', model)
  }

  const refreshCurrentUser = useCallback(async () => {
    setAuthLoading(true)

    try {
      const result = await api.get('/api/user/current')
      const nextUser = result.data?.user || null
      setUserData(nextUser)
      setAuthError('')
      console.log('[Auth] User loaded:', nextUser?.name)
      return nextUser
    } catch (error) {
      const status = error?.response?.status

      if (status === 401) {
        setUserData(null)
        setAuthError('')
        console.warn('[Auth] No active session.')
        return null
      }

      console.warn('[Auth] Could not fetch user:', status, error?.message)
      setUserData(null)
      setAuthError(getErrorMessage(error, 'Unable to verify your session right now.'))
      return null
    } finally {
      setAuthLoading(false)
      setAuthChecked(true)
    }
  }, [api])

  const clearAuthState = useCallback(() => {
    setUserData(null)
    setAuthError('')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.get('/api/auth/logout')
    } catch (error) {
      console.warn('[Auth] Logout request failed:', error?.message)
    } finally {
      clearAuthState()
      setAuthChecked(true)
      setAuthLoading(false)
    }
  }, [api, clearAuthState])

  const getAIResponse = async (command) => {
    console.log(`[API] -> "${command}" [model: ${selectedModel}]`)
    try {
      const result = await api.post('/api/user/asktoassistant', { command, model: selectedModel })
      console.log('[API] <- status:', result.status, '| type:', result.data?.type)
      return result.data
    } catch (error) {
      const status = error?.response?.status
      console.error('[API] Error:', status, error?.message)

      if (status === 401) {
        clearAuthState()
        return {
          type: 'general',
          language: 'english',
          steps: ['error'],
          response: 'Your session has expired. Please sign in again.',
          suggestion: null,
          extra: null,
        }
      }

      if (error?.response?.data?.response) {
        return error.response.data
      }

      return API_FALLBACK
    }
  }

  useEffect(() => {
    refreshCurrentUser()
  }, [refreshCurrentUser])

  const value = {
    serverUrl,
    api,
    userData,
    setUserData,
    backendImage,
    setBackendImage,
    frontendImage,
    setFrontendImage,
    selectedImage,
    setSelectedImage,
    getGeminiResponse: getAIResponse,
    getAIResponse,
    selectedModel,
    changeModel,
    authLoading,
    authChecked,
    authError,
    refreshCurrentUser,
    logout,
    clearAuthState,
  }

  return (
    <userDataContext.Provider value={value}>
      {children}
    </userDataContext.Provider>
  )
}

export default UserContext
