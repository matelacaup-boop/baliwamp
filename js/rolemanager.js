// rolemanager.js - CENTRAL ROLE MANAGEMENT SYSTEM

console.log("role-manager.js loading...");

// Role definitions
const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest'
};

// Role permissions
const PERMISSIONS = {
  admin: {
    canViewAllUsers: true,
    canManageUsers: true,
    canDeleteData: true,
    canModifySettings: true,
    canViewReports: true,
    canExportData: true,
    canManageAlerts: true,
    canViewHistory: true,
    canViewDashboard: true,
    canAccessAllParameters: true
  },
  user: {
    canViewAllUsers: false,
    canManageUsers: false,
    canDeleteData: false,
    canModifySettings: false,
    canViewReports: true,
    canExportData: true,
    canManageAlerts: true,
    canViewHistory: true,
    canViewDashboard: true,
    canAccessAllParameters: true
  },
  guest: {
    canViewAllUsers: false,
    canManageUsers: false,
    canDeleteData: false,
    canModifySettings: false,
    canViewReports: false,
    canExportData: false,
    canManageAlerts: false,
    canViewHistory: false,
    canViewDashboard: true,
    canAccessAllParameters: true
  }
};

// Role display names
const ROLE_LABELS = {
  admin: 'Administrator',
  user: 'User',
  guest: 'Guest'
};

// Get current user role from session or Firebase
async function getCurrentUserRole() {
  try {
    // Check localStorage first
    const userSession = localStorage.getItem('userSession');
    if (userSession) {
      const session = JSON.parse(userSession);
      
      // Guest users
      if (session.isGuest) {
        console.log("User is guest");
        return ROLES.GUEST;
      }
      
      // Authenticated users - fetch from Firebase
      if (session.uid && firebase && firebase.database) {
        const database = firebase.database();
        const snapshot = await database.ref('users/' + session.uid).once('value');
        
        if (snapshot.exists()) {
          const userData = snapshot.val();
          const role = userData.role || ROLES.USER; // Default to 'user' if no role
          console.log("User role:", role);
          return role;
        }
      }
    }
    
    // Default to guest if no session found
    console.log("No session found, defaulting to guest");
    return ROLES.GUEST;
    
  } catch (error) {
    console.error("Error getting user role:", error);
    return ROLES.GUEST;
  }
}

// Check if user has specific permission
async function hasPermission(permissionName) {
  try {
    const role = await getCurrentUserRole();
    const permissions = PERMISSIONS[role];
    
    if (!permissions) {
      console.warn("Unknown role:", role);
      return false;
    }
    
    const allowed = permissions[permissionName] || false;
    console.log(`Permission check: ${permissionName} for ${role} = ${allowed}`);
    return allowed;
    
  } catch (error) {
    console.error("Error checking permission:", error);
    return false;
  }
}

// Get role display label
function getRoleLabel(role) {
  return ROLE_LABELS[role] || 'Unknown';
}

// Check if user is admin
async function isAdmin() {
  const role = await getCurrentUserRole();
  return role === ROLES.ADMIN;
}

// Check if user is regular user
async function isUser() {
  const role = await getCurrentUserRole();
  return role === ROLES.USER;
}

// Check if user is guest
async function isGuest() {
  const role = await getCurrentUserRole();
  return role === ROLES.GUEST;
}

// Redirect based on role
async function redirectBasedOnRole() {
  try {
    const role = await getCurrentUserRole();
    
    switch(role) {
      case ROLES.ADMIN:
        window.location.href = '/html/admindashboard.html';
        break;
      case ROLES.USER:
        window.location.href = '/html/dashboard.html';
        break;
      case ROLES.GUEST:
        window.location.href = '/html/dashboard.html';
        break;
      default:
        window.location.href = '/index.html';
    }
  } catch (error) {
    console.error("Error redirecting based on role:", error);
    window.location.href = '/index.html';
  }
}

// Show/hide elements based on permissions
async function applyRoleBasedUI() {
  try {
    const role = await getCurrentUserRole();
    const permissions = PERMISSIONS[role];
    
    if (!permissions) {
      console.warn("Unknown role, hiding all restricted elements");
      return;
    }
    
    // Hide elements based on permissions
    document.querySelectorAll('[data-permission]').forEach(element => {
      const requiredPermission = element.getAttribute('data-permission');
      
      if (permissions[requiredPermission]) {
        element.style.display = ''; // Show element
      } else {
        element.style.display = 'none'; // Hide element
      }
    });
    
    // Hide elements based on role
    document.querySelectorAll('[data-role]').forEach(element => {
      const requiredRole = element.getAttribute('data-role');
      
      if (role === requiredRole) {
        element.style.display = ''; // Show element
      } else {
        element.style.display = 'none'; // Hide element
      }
    });
    
    // Show elements for specific roles
    document.querySelectorAll('[data-hide-for-role]').forEach(element => {
      const hideForRole = element.getAttribute('data-hide-for-role');
      
      if (role === hideForRole) {
        element.style.display = 'none'; // Hide element
      } else {
        element.style.display = ''; // Show element
      }
    });
    
    console.log("Role-based UI applied for role:", role);
    
  } catch (error) {
    console.error("Error applying role-based UI:", error);
  }
}

// Update user role in Firebase (Admin only)
async function updateUserRole(targetUserId, newRole) {
  try {
    // Check if current user is admin
    const isUserAdmin = await isAdmin();
    if (!isUserAdmin) {
      throw new Error("Only admins can update user roles");
    }
    
    // Validate new role
    if (!Object.values(ROLES).includes(newRole)) {
      throw new Error("Invalid role: " + newRole);
    }
    
    // Update role in Firebase
    const database = firebase.database();
    await database.ref('users/' + targetUserId + '/role').set(newRole);
    await database.ref('users/' + targetUserId + '/roleUpdatedAt').set(firebase.database.ServerValue.TIMESTAMP);
    
    console.log(`Updated user ${targetUserId} role to ${newRole}`);
    return true;
    
  } catch (error) {
    console.error("Error updating user role:", error);
    throw error;
  }
}

// Initialize role-based features on page load
function initRoleManager() {
  console.log("Initializing role manager...");
  
  // Apply role-based UI when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyRoleBasedUI);
  } else {
    applyRoleBasedUI();
  }
}

// Auto-initialize if not already done
initRoleManager();

console.log("✅ role-manager.js loaded");