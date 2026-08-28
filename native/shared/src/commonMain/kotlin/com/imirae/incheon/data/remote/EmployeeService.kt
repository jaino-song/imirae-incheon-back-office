package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*

interface EmployeeService {
    suspend fun getEmployees(search: String? = null): ApiResult<List<Employee>>
    suspend fun getEmployee(id: Int): ApiResult<Employee>
}

class EmployeeServiceImpl(private val client: ApiClient) : EmployeeService {
    override suspend fun getEmployees(search: String?) = client.get<List<Employee>>("/employees" + (search?.let { "?search=$it" } ?: ""))
    override suspend fun getEmployee(id: Int) = client.get<Employee>("/employees/id?id=$id")
}
