// authguard.js - ENHANCED AUTH GUARD WITH ROLE-BASED ACCESS CONTROL

console.log("authguard.js loading...");

(function() {
  'use strict';

  // Check authentication and role on page load
  function checkAuth() {
    console.log("Checking authentication...");

    // Get current page
    const currentPage = window.location.pathname;
    console.log("Current page:", currentPage);

    // Pages that don't require authentication
    const publicPages = [
      '/index.html',
      '/html/signup.html',
      '/forgot-password.html',
      '/html/forgotpassword.html',
      '/'
    ];

    // Check if current page is public
    const isPublicPage = publicPages.some(page => currentPage.endsWith(page));

    if (isPublicPage) {
      console.log("Public page, no auth required");
      return;
    }

    // Check user session
    const userSession = localStorage.getItem('userSession');

    if (!userSession) {
      console.log("❌ No user session found, redirecting to login");
      window.location.href = '/index.html';
      return;
    }

    try {
      const session = JSON.parse(userSession);
      console.log("📋 User session:", session);

      // ==========================================
      // GUEST ACCESS HANDLING (Check FIRST)
      // ==========================================
      if (session.isGuest === true) {
        console.log("🎭 Guest user detected");
        
        // Pages guests can access (ADD ALL PAGES YOU WANT GUESTS TO SEE)
        const guestAllowedPages = [
          '/html/dashboard.html',
          '/html/about.html'
        ];

        const isGuestAllowed = guestAllowedPages.some(page => currentPage.endsWith(page));

        if (!isGuestAllowed) {
          console.log("⚠️ Guest trying to access restricted page, redirecting to dashboard");
          window.location.href = '/html/dashboard.html';
          return;
        }

        console.log("✅ Guest access GRANTED for:", currentPage);
        return; // ← IMPORTANT: Exit here for guests, don't continue to Firebase check
      }

      // ==========================================
      // AUTHENTICATED USER HANDLING
      // ==========================================
      if (session.isLoggedIn && session.uid) {
        console.log("✅ Authenticated user:", session.email, "Role:", session.role || 'user');

        // Check role-based access
        const userRole = session.role || 'user';

        // Admin-only pages
        const adminOnlyPages = [
          '/html/admindashboard.html',
          '/html/user-management.html'
        ];

        const isAdminPage = adminOnlyPages.some(page => currentPage.endsWith(page));

        if (isAdminPage && userRole !== 'admin') {
          console.log("⚠️ Non-admin trying to access admin page, redirecting");
          window.location.href = '/html/dashboard.html';
          return;
        }

        // User and Admin can access regular pages
        console.log("✅ Access GRANTED");
        return;

      } else {
        console.log("❌ Invalid session, redirecting to login");
        localStorage.removeItem('userSession');
        window.location.href = '/index.html';
      }

    } catch (error) {
      console.error("❌ Error parsing session:", error);
      localStorage.removeItem('userSession');
      window.location.href = '/index.html';
    }
  }

  // Firebase auth state check (ONLY for non-guests)
  function checkFirebaseAuth() {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        const userSession = localStorage.getItem('userSession');
        
        if (!user && userSession) {
          const session = JSON.parse(userSession);
          
          // IMPORTANT: Don't clear guest sessions
          if (!session.isGuest && session.isLoggedIn) {
            console.log("⚠️ Session mismatch (not guest), clearing localStorage");
            localStorage.removeItem('userSession');
            
            // Don't redirect on public pages
            const currentPage = window.location.pathname;
            const publicPages = ['/index.html', '/html/signup.html', '/forgot-password.html', '/'];
            const isPublicPage = publicPages.some(page => currentPage.endsWith(page));
            
            if (!isPublicPage) {
              window.location.href = '/index.html';
            }
          }
        }
      });
    }
  }

  // Logout function
  window.logout = async function() {
    console.log("Logging out...");

    try {
      // Clear localStorage
      localStorage.removeItem('userSession');

      // Sign out from Firebase if available
      if (typeof firebase !== 'undefined' && firebase.auth) {
        await firebase.auth().signOut();
        console.log("Signed out from Firebase");
      }

      // Redirect to login
      window.location.href = '/index.html';

    } catch (error) {
      console.error("Logout error:", error);
      // Force logout anyway
      localStorage.removeItem('userSession');
      window.location.href = '/index.html';
    }
  };

  // Get current user info
  window.getCurrentUser = function() {
    const userSession = localStorage.getItem('userSession');
    if (userSession) {
      try {
        return JSON.parse(userSession);
      } catch (error) {
        console.error("Error parsing user session:", error);
        return null;
      }
    }
    return null;
  };

  // Check if user has specific role
  window.hasRole = function(role) {
    const user = window.getCurrentUser();
    if (!user) return false;
    
    if (user.isGuest && role === 'guest') return true;
    
    return user.role === role;
  };

  // Check if user is admin
  window.isAdmin = function() {
    return window.hasRole('admin');
  };

  // Check if user is regular user
  window.isUser = function() {
    return window.hasRole('user');
  };

  // Check if user is guest
  window.isGuest = function() {
    const user = window.getCurrentUser();
    return user && user.isGuest === true;
  };

  // Run auth check immediately
  checkAuth();

  // Check Firebase auth when available (but after a delay for guests)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(checkFirebaseAuth, 500); // Delay to let guest session settle
    });
  } else {
    setTimeout(checkFirebaseAuth, 500);
  }

  console.log("✅ authguard.js loaded");

})();