import { createServerClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createServerClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get all users from the users table
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, role, created_at")
      .order("created_at", { ascending: false })

    if (usersError) {
      console.error("Error fetching users:", usersError)
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    // Get auth users to get email information
    const { data: authData, error: authUsersError } = await supabase.auth.admin.listUsers()

    if (authUsersError) {
      console.error("Error fetching auth users:", authUsersError)
      // Return users without email if we can't get auth data
      return NextResponse.json(users || [])
    }

    // Merge user data with auth data
    const usersWithEmail = users?.map((user) => {
      const authUser = authData.users.find((au) => au.id === user.id)
      return {
        ...user,
        email: authUser?.email || "N/A",
      }
    })

    return NextResponse.json(usersWithEmail || [])
  } catch (error) {
    console.error("Error in users API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createServerClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if the current user is an admin
    const { data: currentUserData, error: currentUserError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single()

    if (currentUserError || currentUserData?.role !== "admin") {
      return NextResponse.json({ error: "Only administrators can update user roles" }, { status: 403 })
    }

    // Get userId and role from request body
    const { userId, role } = await request.json()

    if (!userId || !role) {
      return NextResponse.json({ error: "User ID and role are required" }, { status: 400 })
    }

    // Validate role
    const validRoles = ["ceo", "sales", "purchasing", "accountant", "inventory", "admin"]
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    // Update user role in the users table
    const { error: updateError } = await supabase.from("users").update({ role }).eq("id", userId)

    if (updateError) {
      console.error("Error updating user role:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: "User role updated successfully" })
  } catch (error) {
    console.error("Error in update user API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user ID from request body
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }

    // Prevent users from deleting themselves
    if (userId === user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 })
    }

    // Delete user from auth.users (this will cascade delete from public.users due to ON DELETE CASCADE)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error("Error deleting user:", deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: "User deleted successfully" })
  } catch (error) {
    console.error("Error in delete user API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
