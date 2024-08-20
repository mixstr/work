<?php 

namespace app\core;

use app\controller\CoefficientController;
use app\controller\MonthController;
use app\controller\EmployeeController;

class Router{

    public $act;
    public $method;

    public function __construct(){
        $this->act = $_GET["act"];
        $this->method = $_GET["method"];
        $this->validAct();
    }

    public function validAct(){
        switch($this->act){
            case "month":
                $this->monthMethod();
                break;
            case "employee":
                $this->employeeMethod();
                break;
            case "coefficient":
                $this->coefficientMethod();
                break;
            default:
                echo "Invalid act";
        }
    }

    public function monthMethod($method){
        $month = new MonthController;
        switch($method){
            case "selectAll":
                $month->selectAll();
                break;
            case "selectById":
                $month->selectById($id);
                break;
            case "selectByDay":
                $month->selectByDay($day);
                break;
            case "selectByName":
                $month->selectByName($name);
                break;
            case "selectByMonth":
                $month->selectByMonth($month);
                break;
            case "selectByYear":
                $month->selectByYear($year);
                break;
            case "insert":
                $month->insert($values);
                break;
            case "update":
                $month->update($method);
                break;
            case "delete":
                $month->delete($method);
                break;
            default:
                echo "Invalid method for month";
        }
    }

    public function employeeMethod($method){
        $employee = new EmployeeController;
        switch($method){
            case "selectAll":
                $employee->selectAll();
                break;
            case "selectById":
                $employee->selectById();
                break;
            case "selectByFio":
                $employee->selectByFio();
                break;
            case "selectByHire":
                $employee->selectByHire();
                break;
            case "selectByTermination":
                $employee->selectByTermination();
                break;
            case "insert":
                $employee->insert();
                break;
            case "update":
                $employee->update();
                break;
            case "delete":
                $employee->delete();
                break;
            default:
                echo "Invalid method for employee";
        }
    }

    public function coefficientMethod(){
        $coefficient = new CoefficientController;
        switch($this->method){
            case "selectAll":
                $coefficient->selectAll();
                break;
            case "selectById":
                $id =  $_REQUEST["id"]; 
                $coefficient->selectById($id);
                break;
            case "selectByEmployee":
                $employee_id = $_REQUEST["employee"];
                $coefficient->selectByEmployee($employee_id);
                break;
            case "selectByMonth":
                $month = $_REQUEST["month"];
                $coefficient->selectByMonth($month);
                break;
            case "insert":
                $coefficient->insert();
                break;
            case "update":
                $coefficient->update();
                break;
            case "delete":
                $coefficient->delete();
                break;
            default:
                echo "Invalid method for coefficient";
        }
    }
}