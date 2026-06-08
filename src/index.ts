import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

interface Env extends Cloudflare.Env {
    Project_Planner_Store: KVNamespace;
}

interface Project {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

interface Todo {
	id: string;
	projectId: string;
	title: string;
	description: string;
	status: "pending" | "in_progress" | "completed";
	priority: "low" | "medium" | "high";
	createdAt: string;
	updatedAt: string;
}

type CreateProjectInput = {
	name: string;
	description?: string;
};

type GetByIdInput = {
	project_id: string;
};

type CreateTodoInput = {
	project_id: string;
	title: string;
	description?: string;
	priority?: "low" | "medium" | "high";
};

type UpdateTodoInput = {
	todo_id: string;
	title?: string;
	description?: string;
	status?: "pending" | "in_progress" | "completed";
	priority?: "low" | "medium" | "high";
};

type DeleteTodoInput = {
	todo_id: string;
};

type ListTodosInput = {
	project_id: string;
	status?: "pending" | "in_progress" | "completed" | "all";
};

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Project Planner MCP",
		version: "1.0.0",
	});

	private get kv(): KVNamespace {
		return (this.env as Env).Project_Planner_Store;
	}

	private async getProjectList(): Promise<string[]> {
		const listData = await this.kv.get("project:list");
		return listData ? (JSON.parse(listData) as string[]) : [];
	}

	private async getTodoList(projectID: string): Promise<string[]> {
		const listData = await this.kv.get(`project:${projectID}:todos`);
		return listData ? (JSON.parse(listData) as string[]) : [];
	}

	private async getTodosByProject(projectId: string): Promise<Todo[]> {
		const todoList = await this.getTodoList(projectId);
		const todos: Todo[] = [];

		for (const todoId of todoList) {
			const todoData = await this.kv.get(`todo:${todoId}`);
			if (todoData) {
				todos.push(JSON.parse(todoData) as Todo);
			}
		}

		return todos;
	}

	async init() {
		this.server.tool(
			"create_project",
			"Create a new project",
			{
				name: z.string().describe("Project name"),
				description: z.string().optional().describe("Project description"),
			},
			async (input: CreateProjectInput) => {
				const { name, description } = input;

				const projectID = crypto.randomUUID();

				const project: Project = {
					id: projectID,
					name,
					description: description ?? "",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};

				await this.kv.put(`project:${projectID}`, JSON.stringify(project));

				const projectList = await this.getProjectList();
				projectList.push(projectID);
				await this.kv.put("project:list", JSON.stringify(projectList));

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(project, null, 2),
						},
					],
				};
			}
		);

		this.server.tool(
			"list_projects",
			"List all projects",
			{},
			async () => {
				const projectList = await this.getProjectList();
				const projects: Project[] = [];

				for (const projectId of projectList) {
					const projectData = await this.kv.get(`project:${projectId}`);
					if (projectData) {
						projects.push(JSON.parse(projectData) as Project);
					}
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(projects, null, 2),
						},
					],
				};
			}
		);

		this.server.tool(
			"get_project",
			"Get a specific project by ID",
			{
				project_id: z.string().describe("Project ID"),
			},
			async (input: GetByIdInput) => {
				const { project_id } = input;

				const projectData = await this.kv.get(`project:${project_id}`);

				if (!projectData) {
					throw new Error(`Project with ID ${project_id} not found`);
				}

				const project = JSON.parse(projectData) as Project;
				const todos = await this.getTodosByProject(project_id);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ project, todos }, null, 2),
						},
					],
				};
			}
		);

		this.server.tool(
			"delete_project",
			"Delete a project and all its todos",
			{
				project_id: z.string().describe("Project ID"),
			},
			async (input: GetByIdInput) => {
				const { project_id } = input;

				const projectData = await this.kv.get(`project:${project_id}`);

				if (!projectData) {
					throw new Error(`Project with ID ${project_id} not found`);
				}

				const todos = await this.getTodosByProject(project_id);

				for (const todo of todos) {
					await this.kv.delete(`todo:${todo.id}`);
				}

				await this.kv.delete(`project:${project_id}:todos`);
				await this.kv.delete(`project:${project_id}`);

				const projectList = await this.getProjectList();
				const updatedList = projectList.filter((id) => id !== project_id);
				await this.kv.put("project:list", JSON.stringify(updatedList));

				return {
					content: [
						{
							type: "text",
							text: `Project ${project_id} and all its todos have been deleted`,
						},
					],
				};
			}
		);

		this.server.tool(
			"create_todo",
			"Create a new todo in a project",
			{
				project_id: z.string().describe("Project ID"),
				title: z.string().describe("Todo title"),
				description: z.string().optional().describe("Todo description"),
				priority: z.enum(["low", "medium", "high"]).optional().describe("Todo priority"),
			},
			async (input: CreateTodoInput) => {
				const { project_id, title, description, priority } = input;

				const projectData = await this.kv.get(`project:${project_id}`);

				if (!projectData) {
					throw new Error(`Project with ID ${project_id} not found`);
				}

				const todoId = crypto.randomUUID();

				const todo: Todo = {
					id: todoId,
					projectId: project_id,
					title,
					description: description ?? "",
					status: "pending",
					priority: priority ?? "medium",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};

				await this.kv.put(`todo:${todoId}`, JSON.stringify(todo));

				const todoList = await this.getTodoList(project_id);
				todoList.push(todoId);
				await this.kv.put(
					`project:${project_id}:todos`,
					JSON.stringify(todoList)
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(todo, null, 2),
						},
					],
				};
			}
		);

		this.server.tool(
			"update_todo",
			"Update a todo's properties",
			{
				todo_id: z.string().describe("Todo ID"),
				title: z.string().optional().describe("New todo title"),
				description: z.string().optional().describe("New todo description"),
				status: z
					.enum(["pending", "in_progress", "completed"])
					.optional()
					.describe("New todo status"),
				priority: z.enum(["low", "medium", "high"]).optional().describe("New todo priority"),
			},
			async (input: UpdateTodoInput) => {
				const { todo_id, title, description, status, priority } = input;

				const todoData = await this.kv.get(`todo:${todo_id}`);

				if (!todoData) {
					throw new Error(`Todo with ID ${todo_id} not found`);
				}

				const todo = JSON.parse(todoData) as Todo;

				if (title !== undefined) todo.title = title;
				if (description !== undefined) todo.description = description;
				if (status !== undefined) todo.status = status;
				if (priority !== undefined) todo.priority = priority;

				todo.updatedAt = new Date().toISOString();

				await this.kv.put(`todo:${todo_id}`, JSON.stringify(todo));

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(todo, null, 2),
						},
					],
				};
			}
		);

		this.server.tool(
			"delete_todo",
			"Delete a todo from a project",
			{
				todo_id: z.string().describe("Todo ID"),
			},
			async (input: DeleteTodoInput) => {
				const { todo_id } = input;

				const todoData = await this.kv.get(`todo:${todo_id}`);

				if (!todoData) {
					throw new Error(`Todo with ID ${todo_id} not found`);
				}

				const todo = JSON.parse(todoData) as Todo;

				const todoList = await this.getTodoList(todo.projectId);
				const updatedList = todoList.filter((id) => id !== todo_id);

				await this.kv.put(
					`project:${todo.projectId}:todos`,
					JSON.stringify(updatedList)
				);

				await this.kv.delete(`todo:${todo_id}`);

				return {
					content: [
						{
							type: "text",
							text: `Todo ${todo_id} has been deleted`,
						},
					],
				};
			}
		);

		this.server.tool(
			"get_todo",
			"Get a specific todo by ID",
			{
				todo_id: z.string().describe("Todo ID"),
			},
			async (input: DeleteTodoInput) => {
				const { todo_id } = input;

				const todoData = await this.kv.get(`todo:${todo_id}`);

				if (!todoData) {
					throw new Error(`Todo with ID ${todo_id} not found`);
				}

				const todo = JSON.parse(todoData) as Todo;

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(todo, null, 2),
						},
					],
				};
			}
		);

		this.server.tool(
			"list_todos",
			"List all todos in a project",
			{
				project_id: z.string().describe("Project ID"),
				status: z
					.enum(["pending", "in_progress", "completed", "all"])
					.optional()
					.describe("Filter by status"),
			},
			async (input: ListTodosInput) => {
				const { project_id, status } = input;

				const projectData = await this.kv.get(`project:${project_id}`);

				if (!projectData) {
					throw new Error(`Project with ID ${project_id} not found`);
				}

				let todos = await this.getTodosByProject(project_id);

				if (status && status !== "all") {
					todos = todos.filter((todo) => todo.status === status);
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(todos, null, 2),
						},
					],
				};
			}
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};